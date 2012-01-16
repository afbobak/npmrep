/*jslint devel: false, onevar: false, browser: false, indent: 4 */
/*global module, require*/
/*! Copyright (C) 2012 by Andreas F. Bobak. All Rights Reserved. !*/
var fs = require("fs");
var futures = require("futures");
var request = require("request");
var semver = require("semver");
var url = require("url");
var util = require("util");

function NpmReplicate(config) {
	if (typeof config !== "object") {
		throw new TypeError("Missing configuration");
	}
	this.config = config;
	this.pkgCache = {};
}
util.inherits(NpmReplicate, Object);
exports.NpmReplicate = NpmReplicate;

var npmrep = NpmReplicate.prototype;

npmrep.getPkgInfo = function (repository, pkgName) {
	if (!repository) {
		throw new TypeError("Missing repository");
	}
	if (!pkgName) {
		throw new TypeError("Missing pkgName");
	}
	var future = futures.future();

	var url = repository + pkgName;
	request.get(url, function (error, response, body) {
		future.deliver(error, JSON.parse(body));
	});	

	return future;
};

npmrep.getSrcInfo = function (pkgName) {
	return this.getPkgInfo(this.config.source, pkgName);
};

npmrep.getDstInfo = function (pkgName) {
	return this.getPkgInfo(this.config.destination, pkgName);
};

npmrep.getMatchingPkg = function (range, pkgInfo) {
	if (!range) {
		throw new TypeError("Expected range");
	}
	if (range !== "*" && range !== "latest" && !semver.validRange(range)) {
		throw new TypeError("Expected valid range but was: " + range);
	}
	if (typeof pkgInfo !== "object") {
		throw new TypeError("Excepted pkgInfo to be object but is: " + typeof pkgInfo);
	}
	if (!pkgInfo.versions) {
		throw new TypeError("Excepted pkgInfo.versions");
	}
	var versions = pkgInfo.versions;
	var match;
	var version;
	for (version in versions) {
		if (versions.hasOwnProperty(version) &&
				(range === "latest" || semver.satisfies(version, range)) &&
				(!match || semver.gt(version, match))) {
			match = version;
		}
	}
	return versions[match];
};

npmrep.isSatisfied = function (pkgName, range) {
	var future = futures.future();
	var self = this;

	this.getDstInfo(pkgName).when(function (error, pkgInfo) {
		if (error) {
			return future.deliver(error);
		}
		if (pkgInfo.error === "not_found") {
			return future.deliver(undefined, false);
		}
		var pkg = self.getMatchingPkg(range, pkgInfo);
		future.deliver(undefined, typeof pkg === "object");
	});

	return future;
};

npmrep.getSrcPkg = function (pkgName, range) {
	var future = futures.future();
	var self = this;

	this.getSrcInfo(pkgName).when(function (error, pkgInfo) {
		var pkg = self.getMatchingPkg(range, pkgInfo);
		future.deliver(undefined, pkg);
	});

	return future;
};

npmrep.isPkgResolved = function (pkgName, range) {
	var pkgs = this.pkgCache[pkgName];
	if (pkgs) {
		var i, l = pkgs.length;
		for (i = 0; i < l; i++) {
			if (semver.satisfies(pkgs[i].version, range)) {
				return true;
			}
		}
	}
	return false;
};

npmrep.resolvePackage = function (pkgName, range) {
	var self = this;
	var pending = {};

	function resolve(pkgName, range) {
		var future = futures.future();
		var pkgId = pkgName + "@" + range;
		console.log("Resolving " + pkgId);

		if (pending[pkgId]) {
			// Pending
			console.log(" -> pending " + pkgId);
			future.deliver();

		} else if (self.isPkgResolved(pkgName, range)) {
			// Already resolved
			console.log(" -> already resolved " + pkgId);
			future.deliver(undefined, self.pkgCache);

		} else {

			pending[pkgId] = future;

			// Grab package from source registry
			self.getSrcPkg(pkgName, range).when(function (error, pkg) {
				console.log("getSrcPkg - " + pkgId);
				if (error) {
					delete pending[pkgId];
					return future.deliver(error);
				}

				var futes = [];

				// Resolve dependencies
				function resolveDependencies(dependencies) {
					if (!dependencies) {
						return;
					}
					var dep;
					for (dep in dependencies) {
						if (dependencies.hasOwnProperty(dep)) {
							var depRange = dependencies[dep];
							if (!self.isPkgResolved(dep, depRange)) {
								futes.push(resolve(dep, depRange));
							}
						}
					}
				}
				resolveDependencies(pkg.dependencies);
				resolveDependencies(pkg.devDependencies);

				function done() {
					if (!self.pkgCache[pkg.name]) {
						self.pkgCache[pkg.name] = [];
					}
					self.pkgCache[pkg.name].push(pkg);
					console.log(" -> resolved " + pkgName + "@" + pkg.version);
					delete pending[pkgId];
					future.deliver(undefined, self.pkgCache);
				}

				if (futes.length) {
					// Wait until everything's resolved
					var j = futures.join();
					j.add(futes);
					j.when(done);

				} else {
					// No dependencies, we're done
					done();
				}
			});
		}

		return future;
	}

	return resolve(pkgName, range);
};

npmrep.makeDestinationUrl = function (part) {
	var config = this.config;
	var uri = url.parse(url.resolve(config.destination, part));
	uri.auth = config.auth;
	return url.format(uri);
};

npmrep.createPackage = function (pkg) {
	if (!pkg) {
		throw new TypeError("Missing pkg");
	}
	if (!pkg.name) {
		throw new TypeError("Missing pkg.name");
	}

	var self = this;
	var future = futures.future();

	var fullData = {
		_id: pkg.name,
		name: pkg.name,
		description: pkg.description,
		"dist-tags": {},
		versions: {},
		repository: pkg.repository,
		maintainers: pkg.maintainers
	};

	var uri = self.makeDestinationUrl(encodeURIComponent(pkg.name));
	request.put({
		uri: uri,
		json: fullData
	}, function (error, response, body) {
		// A 409 is expected here, if this is a new version of an existing package.
		if (error && !(response && response.statusCode === 409)) {
			return future.deliver({
				error: "failed-create",
				reason: "Failed to create package to destination server",
				details: error
			});
		}
		// Confict is the 409 error above
		if (body.error && body.error !== "conflict") {
			return future.deliver({
				error: "failed-create",
				reason: "Error while creating package to destination server",
				details: body
			});
		}
		future.deliver();
	});

	return future;
};

npmrep.putPackage = function (pkg) {
	if (!pkg) {
		throw new TypeError("Missing pkg");
	}
	if (!pkg.name) {
		throw new TypeError("Missing pkg.name");
	}
	if (!semver.valid(pkg.version)) {
		throw new TypeError("Invalid pkg.version");
	}
	var self = this;
	var future = futures.future();

	this.createPackage(pkg).when(function (error) {
		if (error) {
			return future.deliver(error);
		}
		var pkgName = encodeURIComponent(pkg.name);
		var pkgURI = pkgName + "/" + encodeURIComponent(pkg.version);
		var tbName = pkg.name + "-" + pkg.version + ".tgz";
		var tbURI = pkgName + "/-/" + encodeURIComponent(tbName);

		var dstPkg = JSON.parse(JSON.stringify(pkg));
		dstPkg.dist.tarball = url.resolve(self.config.destination, tbURI);

		request.put({
			uri: self.makeDestinationUrl(pkgURI),
			json: dstPkg
		}, function (error, response, body) {
			if (error) {
				return future.deliver({
					error: "failed-package",
					reason: "Failed to add package to destination server.",
					details: error
				});
			}
			if (body.error) {
				return future.deliver({
					error: "failed-package",
					reason: "Error adding package to destination server",
					details: body
				});
			}

			future.deliver(undefined, dstPkg, tbURI);
		});
	});

	return future;
};

npmrep.putTarball = function (srcURI, dstURI) {
	var self = this;
	var future = futures.future();

	request.get(srcURI, function (error, response, body) {
		if (error || body.error) {
			return future.deliver({
				error: "failed-tarball",
				reason: "Failed to download tarball from source server",
				details: error || body
			});
		}
	}).pipe(request.put(dstURI, function (error, response, body) {
		if (error || body.error) {
			return future.deliver({
				error: "failed-tarball",
				reason: "Failed to upload tarball to destination server",
				details: error || body
			});
		}
		future.deliver();
	}));

	return future;
};

npmrep.getPkgRevision = function (pkg) {
	var self = this;
	var future = futures.future();

	var dst = url.resolve(self.config.destination, encodeURIComponent(pkg.name));
	request.get(dst, function (error, response, body) {
		if (error) {
			return future.deliver({
				error: "failed-replicate",
				reason: "Failed to retrieve package information from source server",
				details: error
			});
		}
		var rev = JSON.parse(body)._rev;
		future.deliver(undefined, rev);
	});

	return future;
};

npmrep.replicatePkg = function (pkg) {
	if (!pkg) {
		throw new TypeError("Missing pkg");
	}
	if (!pkg.dist) {
		throw new TypeError("Missing pkg.dist");
	}
	if (!pkg.dist.tarball) {
		throw new TypeError("Missing pkg.dist.tarball");
	}
	var self = this;
	var future = futures.future();

	this.putPackage(pkg).when(function (error, dstPkg, tbURI) {
		if (error) {
			return future.deliver(error);
		}
		console.log(" -> replicated package data " + pkg.name + "@" + pkg.version);

		self.getPkgRevision(pkg).when(function (error, rev) {
			if (error) {
				return future.deliver(error);
			}

			console.log(" -> uploading tarball " + pkg.name + "@" + pkg.version);
			var dst = self.makeDestinationUrl(tbURI + "/" + rev);
			self.putTarball(pkg.dist.tarball, dst).when(function (error) {
				console.log(" -> replicated package tarball " + pkg.name + "@" + pkg.version);
				future.deliver(error, dstPkg);
			});
		});
	});

	return future;
};

npmrep.replicate = function (pkgName, range) {
	var future = futures.future();
	var self = this;

	this.resolvePackage(pkgName, range).when(function (error, pkgs) {
		if (error) {
			return future.deliver(error);
		}
		if (!pkgs) {
			return future.deliver();
		}

		var i, l;
		var replicating = [];

		function replicateWhenSatisfied(pkg) {
			var f = futures.future();
			self.isSatisfied(pkg.name, pkg.version).when(function (error, satisfied) {
				if (!satisfied) {
					console.log("Replicating " + pkg.name + "@" + pkg.version);
					self.replicatePkg(pkg).when(function (error, dstPkg) {
						console.log(" -> replicated " + pkg.name + "@" + pkg.version);
						f.deliver(error, dstPkg);
					});
				} else {
					console.log(" -> already satisfied " + pkg.name + "@" + pkg.version);
					f.deliver(undefined, pkg);
				}
			});
			return f;
		}

		var pkgName;
		for (pkgName in pkgs) {
			if (pkgs.hasOwnProperty(pkgName)) {
				var versions = pkgs[pkgName];
				for (i = 0, l = versions.length; i < l; i++) {
					var pkg = versions[i];
					replicating.push(replicateWhenSatisfied(pkg));
				}
			}
		}

		if (replicating.length) {
			var j = futures.join();
			j.add(replicating);
			j.when(function () {
				for (i = 0, l = arguments.length; i < l; i++) {
					// First argument given = error
					if (arguments[i][0]) {
						return future.deliver(arguments[i][0], arguments[i][1]);
					}
				}

				// Everything's fine, probably...
				future.deliver();
			});

		} else {
			future.deliver();
		}
	});

	return future;
};

exports.create = function (config) {
	return new NpmReplicate(config);
};

exports.replicate = function (config, pkgId) {
	var pkgNameVersion = pkgId.split("@");
	if (pkgNameVersion.length === 1) {
		pkgNameVersion.push("latest");
	}
	var npmrep = new NpmReplicate(config);
	return npmrep.replicate(pkgNameVersion[0], pkgNameVersion[1]);
};
