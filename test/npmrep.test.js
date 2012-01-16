/*jslint devel: true, onevar: false, browser: true, indent: 4 */
/*globals require*/
/*! Copyright (C) 2012 by Andreas F. Bobak. All Rights Reserved. !*/

var assert = require("assert");
var futures = require("futures");
var request = require("request");
var sinon = require("sinon");
var npmrep = require("../lib/npmrep");

var TEST_CONFIG = {
	source: "https://registry.npmjs.org/",
	destination: "https://something.else/"
};

var PICK_ME_MATCH = {
	"dist-tags": {
		"latest": "0.5.0"
	},
	"versions": {
		"0.1.2": {},
		"0.4.0": {},
		"0.4.1": {"pick": "me"},
		"0.5.0": {"is": "latest"}
	}
};

var TEST_PACKAGE = {
	"versions": {
		"0.4.1": {
			"name": "pkgname",
			"version": "0.4.1",
			"dependencies": {
				"dep1": "1.0.x",
				"dep2": "2.1.x"
			},
			"dist": {
				"shasum": "0e0f84582ebd6ea0a4190739001b4af3d2c3d188",
				"tarball": "http://registry.npmjs.org/pkgname/-/pkgname-0.4.1.tgz"
			}
		}
	}
};

exports["should require configuration"] = sinon.test(function (beforeExit) {
	assert.throws(function () {
		npmrep.create();
	}, "TypeError");
});

exports["should create configured npmreq object"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);

	assert(typeof rep, "object");
	assert.deepEqual(rep.config, TEST_CONFIG);
});

exports["should require package name"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);

	assert.throws(function () {
		rep.getPkgInfo();
	}, "TypeError");
});

exports["should return and deliver future when info done"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var get = this.stub(request, "get").callsArgWith(1, undefined, "response", "{\"some\":\"json\"}");
	var stub = this.stub();

	assert.doesNotThrow(function () {
		rep.getPkgInfo("http://some.url/", "pkgname").when(stub);
	}, "TypeError");

	sinon.assert.calledOnce(stub);
});

exports["should only deliver future once pkginfo request returned"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var get = this.stub(request, "get");
	var stub = this.stub();

	rep.getPkgInfo("http://some.url/", "pkgname").when(stub);

	sinon.assert.notCalled(stub);
});

exports["should retrieve package information from source server"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");

	rep.getSrcInfo("pkgname");

	sinon.assert.calledOnce(stub);
	sinon.assert.calledWith(stub, TEST_CONFIG.source + "pkgname");
});

exports["should retrieve package information from destination server"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");

	rep.getSrcInfo("pkgname");

	sinon.assert.calledOnce(stub);
	sinon.assert.calledWith(stub, TEST_CONFIG.source + "pkgname");
});

exports["should pass package information to future"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");
	stub.callsArgWith(1, undefined, {}, "{\"some\":\"json\"}");
	var spy = sinon.spy();

	rep.getPkgInfo("http://some.url/", "pkgname").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, {some: "json"});
});

exports["should return package with best matching version"] = function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var match = rep.getMatchingPkg("0.4.x", PICK_ME_MATCH);

	assert.deepEqual(match, {"pick": "me"});
};

exports["should return latest package version"] = function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var match = rep.getMatchingPkg("latest", PICK_ME_MATCH);

	assert.deepEqual(match, {"is": "latest"});
};

exports["should return latest available package version"] = function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var match = rep.getMatchingPkg("*", PICK_ME_MATCH);

	assert.deepEqual(match, {"is": "latest"});
};

exports["should satisfy version"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub1 = this.stub(request, "get");
	stub1.callsArgWith(1, undefined, {}, "{\"some\":\"json\"}");
	var stub2 = this.stub(rep, "getMatchingPkg");
	stub2.returns({"version": "0.1.2"});
	var spy = sinon.spy();

	rep.isSatisfied("pkgname", "0.1.x").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, true);
	sinon.assert.calledOnce(stub1);
	sinon.assert.calledWith(stub1, TEST_CONFIG.destination + "pkgname");
	sinon.assert.calledOnce(stub2);
	sinon.assert.calledWith(stub2, "0.1.x", {some: "json"});
});

exports["should not satisfy version"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub1 = this.stub(request, "get");
	stub1.callsArgWith(1, undefined, {}, "{\"some\":\"json\"}");
	var stub2 = this.stub(rep, "getMatchingPkg");
	stub2.returns(undefined);
	var spy = sinon.spy();

	rep.isSatisfied("pkgname", "0.1.x").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, false);
});

exports["should not satisfy version if not_found"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	this.stub(rep, "getDstInfo").returns({
		when: function (callback) {
			callback(undefined, {"error": "not_found"});
		}
	});
	this.stub(rep, "getMatchingPkg");
	var spy = sinon.spy();

	rep.isSatisfied("pkgname", "0.1.x").when(spy);

	sinon.assert.notCalled(rep.getMatchingPkg);
	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, false);
});

exports["should get matching source package"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");
	stub.callsArgWith(1, undefined, {}, JSON.stringify(PICK_ME_MATCH));
	var spy = sinon.spy();

	rep.getSrcPkg("pkgname", "0.4.x").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, {"pick": "me"});
	sinon.assert.calledOnce(stub);
	sinon.assert.calledWith(stub, TEST_CONFIG.source + "pkgname");
});

exports["should not have package resolved"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);

	var resolved = rep.isPkgResolved("pkgname", "0.4.x");
	
	assert.equal(resolved, false);
});

exports["should have package resolved"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	rep.pkgCache = {
		"pkgname": [{
			"name": "pkgname",
			"version": "0.4.1"
		}]
	};

	var resolved = rep.isPkgResolved("pkgname", "0.4.x");

	assert.ok(resolved);
});

exports["should resolve dependencies for package"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");
	stub.withArgs(TEST_CONFIG.source + "pkgname").callsArgWith(1, undefined, {}, JSON.stringify(TEST_PACKAGE));
	stub.withArgs(TEST_CONFIG.source + "dep1").callsArgWith(1, undefined, {}, JSON.stringify({"versions": {"1.0.1": {"name": "dep1"}}}));
	stub.withArgs(TEST_CONFIG.source + "dep2").callsArgWith(1, undefined, {}, JSON.stringify({"versions": {"2.1.1": {"name": "dep2"}}}));
	var spy = sinon.spy();

	rep.resolvePackage("pkgname", "0.4.x").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, {
		"pkgname": [TEST_PACKAGE.versions["0.4.1"]],
		"dep1": [{"name": "dep1"}],
		"dep2": [{"name": "dep2"}]
	});
});

exports["should resolve circular dependencies"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "get");
	stub.withArgs(TEST_CONFIG.source + "pkgname").callsArgWith(1, undefined, {}, JSON.stringify(TEST_PACKAGE));
	stub.withArgs(TEST_CONFIG.source + "dep1").callsArgWith(1, undefined, {}, JSON.stringify({
		"versions": {
			"1.0.1": {
				"name": "dep1",
				"dependencies": {
					"dep1": "1.0.x"
				}
			}
		}
	}));
	stub.withArgs(TEST_CONFIG.source + "dep2").callsArgWith(1, undefined, {}, JSON.stringify({"versions": {"2.1.1": {"name": "dep2"}}}));
	var spy = sinon.spy();

	rep.resolvePackage("pkgname", "0.4.x").when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, {
		"pkgname": [TEST_PACKAGE.versions["0.4.1"]],
		"dep1": [{
			"name": "dep1",
			"dependencies": {
				"dep1": "1.0.x"
			}
		}],
		"dep2": [{"name": "dep2"}]
	});
});

exports["should not resolve already resolved dependency"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	rep.pkgCache = {
		"pkgname": [{
			"name": "pkgname",
			"version": "0.4.1"
		}]
	};
	var stub = this.stub(rep, "getSrcPkg").returns(futures.future());
	var spy = sinon.spy();

	rep.resolvePackage("pkgname", "0.4.x").when(spy);

	sinon.assert.notCalled(stub);
	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, rep.pkgCache);
});

exports["should upload package information"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var stub = this.stub(request, "put").callsArgWith(1, undefined, "response", "body");
	var spy = sinon.spy();

	rep.putPackage(TEST_PACKAGE.versions["0.4.1"]).when(spy);

	sinon.assert.calledTwice(stub);
	var expected = JSON.parse(JSON.stringify(TEST_PACKAGE.versions["0.4.1"]));
	expected.dist.tarball = "https://something.else/pkgname/-/pkgname-0.4.1.tgz";
	sinon.assert.calledWith(stub, {
		uri: "https://something.else/pkgname",
		json: {
			_id: expected.name,
			name: expected.name,
			description: expected.description,
			"dist-tags": {},
			versions: {},
			repository: expected.repository,
			maintainers: expected.maintainers
		}
	});
	sinon.assert.calledWith(stub, {
		uri: "https://something.else/pkgname/0.4.1",
		json: expected
	});
	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, undefined, expected, "pkgname/-/pkgname-0.4.1.tgz");
});

exports["should replicate tarball to destination"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var get = this.stub(request, "get").callsArgWith(1, undefined, "response", "body");
	var pipe = sinon.spy();
	get.returns({pipe: pipe});
	var put = this.stub(request, "put").callsArgWith(1, undefined, "response", "body");
	var spy = sinon.spy();

	var srcURI = TEST_PACKAGE.versions["0.4.1"].dist.tarball;
	var dstURI = "http://something.else/pkgname/-/pkgname-0.4.1.tgz";
	rep.putTarball(srcURI, dstURI).when(spy);

	sinon.assert.calledOnce(get);
	sinon.assert.calledWith(get, srcURI);
	sinon.assert.calledOnce(pipe);
	sinon.assert.calledOnce(put);
	sinon.assert.calledWith(put, dstURI);
	sinon.assert.calledOnce(spy);
	sinon.assert.calledWithExactly(spy);
});

exports["should replicate single package"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	var f1 = futures.future();
	this.stub(rep, "putPackage").returns(f1);
	var f2 = futures.future();
	this.stub(rep, "getPkgRevision").returns(f2);
	var f3 = futures.future();
	this.stub(rep, "putTarball").returns(f3);
	var spy = sinon.spy();

	rep.replicatePkg(TEST_PACKAGE.versions["0.4.1"]).when(spy);
	f1.deliver(undefined, {
		dist: {
			tarball: "dstURI"
		}
	}, "tbURI");
	f2.deliver(undefined, "revision");
	f3.deliver(undefined);

	sinon.assert.calledOnce(rep.putPackage);
	sinon.assert.calledOnce(rep.putTarball);
	sinon.assert.calledOnce(spy);
	sinon.assert.calledWithExactly(spy, undefined, {
		dist: {
			tarball: "dstURI"
		}
	});
	sinon.assert.callOrder(rep.putPackage, rep.getPkgRevision, rep.putTarball, spy);
});

exports["should deliver error when not authorized"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	this.stub(request, "put").callsArgWith(1, undefined,  "response", {error: "forbidden"});
	var spy = sinon.spy();

	rep.createPackage(TEST_PACKAGE.versions["0.4.1"]).when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWith(spy, {
		error: "failed-create",
		reason: "Error while creating package to destination server",
		details: {error: "forbidden"}
	});
});

exports["should ignore package creation if conflict"] = sinon.test(function (beforeExit) {
	var rep = npmrep.create(TEST_CONFIG);
	this.stub(request, "put").callsArgWith(1, undefined,  "response", {error: "conflict"});
	var spy = sinon.spy();

	rep.createPackage(TEST_PACKAGE.versions["0.4.1"]).when(spy);

	sinon.assert.calledOnce(spy);
	sinon.assert.calledWithExactly(spy);
});
