/**
 ******************************************************************************
 * @file    lib/ApiClient.js
 * @author  David Middlecamp (david@spark.io)
 * @company Particle ( https://www.particle.io/ )
 * @source https://github.com/spark/particle-cli
 * @version V1.0.0
 * @date    14-February-2014
 * @brief   Basic API wrapper module
 ******************************************************************************
Copyright (c) 2014 Spark Labs, Inc.  All rights reserved.

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public
License along with this program; if not, see <http://www.gnu.org/licenses/>.
 ******************************************************************************
 */
'use strict';


/**
 *
 * Example Usage:
 *
 *     # on command line in test dir
 *     node
 *
 *     # in node Repl
 *     var ApiClient = require('./ApiClient')
 *     var a = new ApiClient('http://localhost:9090')
 *     a.createUser('j3@j3.com','j3')
 *     a.login('j3@j3.com','j3')
 *     TODO: How to use this function: a.claimDevice('3').then(function(g,b) { console.log("AAAAAAAAAAA", g,b) })
 *
 **/
var when = require('when');
var pipeline = require('when/pipeline');
var utilities = require('../lib/utilities.js');

var request = require('request');
var fs = require('fs');
var Spinner = require('cli-spinner').Spinner;
var chalk = require('chalk');

/**
 * Provides a framework for interacting with and testing the API
 *
 */

var ApiClient = function (baseUrl, access_token) {
	this.baseUrl = baseUrl;
	if (this.baseUrl && this.baseUrl.slice(-1) === '/') {
		this.baseUrl = this.baseUrl.slice(0, -1);
	}
	this._access_token = access_token;
};

ApiClient.prototype = {
	ready: function() {
		var hasToken = !!this._access_token;
		if (!hasToken) {
			console.log("You're not logged in. Please login using", chalk.bold.cyan('particle cloud login'), 'before using this command');
		}

		return hasToken;
	},

	clearToken: function() {
		this._access_token = null;
	},

	getToken: function () {
		return this._access_token;
	},

	updateToken: function(token) {
		this._access_token = token;
	},


	createUser: function (user, pass) {
		var dfd = when.defer();

		//todo; if !user, make random?
		//todo; if !pass, make random?

		//curl -d username=zachary@particle.io -d password=foobar https://api.particle.io/v1/users

		if (!user || (user === '')
			|| (!utilities.contains(user, '@'))
			|| (!utilities.contains(user, '.'))) {
			return when.reject('Username must be an email address.');
		}


		console.log('creating user: ', user);
		var that = this;

		request({
			uri: this.baseUrl + '/v1/users',
			method: 'POST',
			form: {
				username: user,
				password: pass
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (body && body.ok) {
				console.log('user creation succeeded!');
				that._user = user;
				that._pass = pass;
			} else if (body && !body.ok && body.errors) {
				console.log('User creation ran into an issue: ', body.errors);
			} else {
				console.log('createUser got ', body + '');
			}

			dfd.resolve(body);
		});

		return dfd.promise;
	},

	//GET /oauth/token
	login: function (client_id, user, pass) {
		var that = this;

		return this.createAccessToken(client_id, user, pass)
			.then(function(resp) {
				that._access_token = resp.access_token;

				return when.resolve(that._access_token);
			},
			function(err) {
				return when.reject('Login Failed: ' + err);
			});
	},

	//GET /oauth/token
	createAccessToken: function (client_id, username, password) {
		var that = this;
		return when.promise(function (resolve, reject) {
			request({
				uri: that.baseUrl + '/oauth/token',
				method: 'POST',
				form: {
					username: username,
					password: password,
					grant_type: 'password',
					client_id: client_id,
					client_secret: 'client_secret_here'
				},
				json: true
			}, function (error, response, body) {
				if (error) {
					return reject(error);
				}
				if (body.error) {
					reject(body.error_description);
				} else {
					resolve(body);
				}
			});
		});
	},

	//DELETE /v1/access_tokens/{ACCESS_TOKEN}
	removeAccessToken: function (username, password, access_token) {
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/access_tokens/' + access_token,
			method: 'DELETE',
			auth: {
				username: username,
				password: password
			},
			form: {
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				console.error('error removing token: ' + error);
				return dfd.reject(error);
			}

			if (body && body.ok) {
				dfd.resolve(body);
			} else if (body && (body.error || body.errors)) {
				dfd.reject(body.error || body.errors);
			} else {
				//huh?
				dfd.reject(body);
			}
		});

		return dfd.promise;
	},

	//GET /v1/access_tokens
	listTokens: function (username, password) {
		var that = this;
		return when.promise(function (resolve, reject) {
			request({
				uri: that.baseUrl + '/v1/access_tokens',
				method: 'GET',
				auth: {
					username: username,
					password: password
				},
				json: true
			}, function (error, response, body) {
				if (error) {
					return reject(error);
				}
				if (that.hasBadToken(body)) {
					return reject('Invalid token');
				}
				if (error || (body['ok'] === false)) {
					var err = error || body.errors;
					if (typeof err == 'object') {
						err = err.join(', ');
					}
					console.error('error listing tokens: ', err);
					reject(error || body.errors);
				} else {
					resolve(body);
				}
			});
		});
	},


	//GET /v1/devices
	listDevices: function () {
		var spinner = new Spinner('Retrieving devices...');
		spinner.start();

		var that = this;
		var prom = when.promise(function(resolve, reject) {
			request({
				uri: that.baseUrl + '/v1/devices?access_token=' + that._access_token,
				method: 'GET',
				json: true
			}, function (error, response, body) {
				if (error) {
					return reject(error);
				}
				if (that.hasBadToken(body)) {
					return reject('Invalid token');
				}
				if (body.error) {
					console.error('listDevices got error: ', body.error);
					reject(body.error);
				} else {
					that._devices = body;
					resolve(body);
				}
			});
		});

		prom.finally(function () {
			spinner.stop(true);
		});

		return prom;
	},

	claimDevice: function (deviceId) {
		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/devices',
			method: 'POST',
			form: {
				id: deviceId,
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}

			if (body && body.ok) {
				dfd.resolve(body);
			} else if (body && body.errors) {
				dfd.reject(body.errors.join('\n'));
			}
		});

		return dfd.promise;
	},

	removeDevice: function (deviceID) {
		console.log('releasing device ' + deviceID);

		var dfd = when.defer();
		var that = this;

		request({
			uri: this.baseUrl + '/v1/devices/' + deviceID,
			method: 'DELETE',
			form: {
				id: deviceID,
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}

			if (body && body.ok) {
				dfd.resolve(body);
			} else if (body && body.error) {
				dfd.reject(body.error);
			}
		});

		return dfd.promise;
	},


	renameDevice: function (deviceId, name) {
		var that = this;
		var dfd = when.defer();

		request({
			uri: this.baseUrl + '/v1/devices/' + deviceId,
			method: 'PUT',
			form: {
				name: name,
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}

			if (body && (body.name === name)) {
				dfd.resolve(body);
			} else {
				dfd.reject(body);
			}
		});

		return dfd.promise;
	},

	//GET /v1/devices/{DEVICE_ID}
	getAttributes: function (deviceId) {
		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/devices/' + deviceId + '?access_token=' + this._access_token,
			method: 'GET',
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			dfd.resolve(body);
		});

		return dfd.promise;
	},

	//GET /v1/devices/{DEVICE_ID}/{VARIABLE}
	getVariable: function (deviceId, name) {
		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/devices/' + deviceId + '/' + name + '?access_token=' + this._access_token,
			method: 'GET',
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			dfd.resolve(body);
		});

		return dfd.promise;
	},

	//PUT /v1/devices/{DEVICE_ID}
	signalDevice: function (deviceId, beSignalling) {
		var dfd = when.defer();
		var that = this;
		request({
			uri: this.baseUrl + '/v1/devices/' + deviceId,
			method: 'PUT',
			form: {
				signal: (beSignalling) ? 1 : 0,
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}

			dfd.resolve(body);
		});

		return dfd.promise;
	},

	//PUT /v1/devices/{DEVICE_ID}
	flashDevice: function (deviceId, files) {
		console.log('attempting to flash firmware to your device ' + deviceId);

		var that = this;
		var dfd = when.defer();
		var r = request.put(this.baseUrl + '/v1/devices/' + deviceId + '?access_token=' + this._access_token, {
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			//console.log(error, response, body);
			dfd.resolve(body);
		});

		var form = r.form();
		for (var name in files) {
			form.append(name, fs.createReadStream(files[name]), {
				filename: files[name]
			});
		}

		return dfd.promise;
	},

	compileCode: function(files, platform_id) {
		console.log('attempting to compile firmware ');

		var that = this;
		var dfd = when.defer();
		var r = request.post(this.baseUrl + '/v1/binaries?access_token=' + this._access_token, {
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			dfd.resolve(body);
		});

		var form = r.form();
		for (var name in files) {
			console.log('pushing file: ' + files[name]);
			form.append(name, fs.createReadStream(files[name]), {
				filename: files[name]
			});
			//for latest arg
			//form.append("branch", "compile-server2");
			//form.append("latest", "true");
		}
		form.append('platform_id', platform_id);

		return dfd.promise;
	},

	downloadBinary: function (url, filename) {
		if (fs.existsSync(filename)) {
			try {
				fs.unlinkSync(filename);
			} catch (ex) {
				console.error('error deleting file: ' + filename + ' ' + ex);
			}
		}

		var outFs = fs.createWriteStream(filename);

		var that = this;
		var dfd = when.defer();
		console.log('grabbing binary from: ' + this.baseUrl + url);
		request.get(this.baseUrl + url + '?access_token=' + this._access_token, null,
			function (error, response, body) {
				if (error) {
					return dfd.reject(error);
				}
				if (that.hasBadToken(body)) {
					return dfd.reject('Invalid token');
				}
				dfd.resolve(body);
			}).pipe(outFs);
		return dfd.promise;
	},

	sendPublicKey: function (deviceId, buffer, algorithm, productId) {
		console.log('attempting to add a new public key for device ' + deviceId);

		var dfd = when.defer();
		var that = this;

		var params = {
			uri: this.baseUrl + '/v1/provisioning/' + deviceId,
			method: 'POST',
			form: {
				deviceID: deviceId,
				publicKey: buffer.toString(),
				order: 'manual_' + Date.now(),
				filename: 'cli',
				algorithm: algorithm,
				access_token: this._access_token
			},
			json: true
		};

		if (productId !== undefined) {
			params.form.product_id = productId;
		}

		request(params, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			if (body.error) {
				dfd.reject(body.error);
			} else {
				console.log('submitting public key succeeded!');
				dfd.resolve(response);
			}

			that._devices = body;
		});

		return dfd.promise;
	},

	callFunction: function (deviceId, functionName, funcParam) {
		//console.log('callFunction for user ');

		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/devices/' + deviceId + '/' + functionName,
			method: 'POST',
			form: {
				arg: funcParam,
				access_token: this._access_token
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			dfd.resolve(body);
		});

		return dfd.promise;
	},

	getAllAttributes: function () {
		if (this._attributeCache) {
			return when.resolve(this._attributeCache);
		}

		console.error('polling server to see what devices are online, and what functions are available');

		var that = this;
		var lookupAttributes = function (devices) {
			var tmp = when.defer();

			if (!devices || (devices.length === 0)) {
				console.log('No devices found.');
				that._attributeCache = null;
				tmp.reject('No devices found');
			} else {
				var promises = [];
				for (var i = 0; i < devices.length; i++) {
					var deviceid = devices[i].id;
					if (devices[i].connected) {
						promises.push(that.getAttributes(deviceid));
					} else {
						promises.push(when.resolve(devices[i]));
					}
				}

				when.all(promises).then(function (devices) {
					//sort alphabetically
					devices = devices.sort(function (a, b) {
						return (a.name || '').localeCompare(b.name);
					});

					that._attributeCache = devices;
					tmp.resolve(devices);
				});
			}
			return tmp.promise;
		};

		return pipeline([
			that.listDevices.bind(that),
			lookupAttributes
		]);
	},

	getEventStream: function (eventName, deviceId, onDataHandler) {
		var url;
		if (!deviceId) {
			url = '/v1/events';
		} else if (deviceId === 'mine') {
			url = '/v1/devices/events';
		} else {
			url = '/v1/devices/' + deviceId + '/events';
		}

		if (eventName) {
			url += '/' + eventName;
		}

		console.log('Listening to: ' + url);
		var requestObj = request({
			uri: this.baseUrl + url + '?access_token=' + this._access_token,
			method: 'GET'
		});

		if (onDataHandler) {
			requestObj.on('data', onDataHandler);
		}

		return requestObj;
	},

	publishEvent: function (eventName, data, setPrivate) {
		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/devices/events',
			method: 'POST',
			form: {
				name: eventName,
				data: data,
				access_token: this._access_token,
				private: setPrivate
			},
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			if (body && body.ok) {
				var consolePrint = '';
				consolePrint += 'Published ';
				if (setPrivate) {
					consolePrint += 'private';
				} else {
					consolePrint += 'public';
				}

				console.log(consolePrint,'event:',eventName);
				console.log('');
				dfd.resolve(body);
			} else if (body && body.error) {
				console.log('Server said', body.error);
				dfd.reject(body);
			}
		});

		return dfd.promise;
	},

	createWebhookWithObj: function(obj) {
		var that = this;
		var dfd = when.defer();

		var obj = {
			uri: this.baseUrl + '/v1/webhooks',
			method: 'POST',
			json: obj,
			headers: {
				'Authorization': 'Bearer ' + this._access_token
			}
		};

		console.log('Sending webhook request ', obj);

		request(obj, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			if (body && body.ok) {
				console.log('Successfully created webhook with ID ' + body.id);
				dfd.resolve(body);
			} else if (body && body.error) {
				dfd.reject(body.error);
			} else {
				dfd.reject(body);
			}
		});

		return dfd.promise;
	},

	createWebhook: function (event, url, deviceId, requestType, headers, json, query, auth, mydevices, rejectUnauthorized) {
		var that = this;
		var dfd = when.defer();

		var obj = {
			uri: this.baseUrl + '/v1/webhooks',
			method: 'POST',
			json: true,
			form: {
				event: event,
				url: url,
				deviceid: deviceId,
				access_token: this._access_token,
				requestType: requestType,
				headers: headers,
				json: json,
				query: query,
				auth: auth,
				mydevices: mydevices,
				rejectUnauthorized: rejectUnauthorized
			}
		};

		console.log('Sending webhook request ', obj);

		request(obj, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			if (body && body.ok) {
				console.log('Successfully created webhook!');
				dfd.resolve(body);
			} else if (body && body.error) {
				dfd.reject(body.error);
			} else {
				dfd.reject(body);
			}
		});

		return dfd.promise;
	},

	deleteWebhook: function (hookID) {
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/webhooks/' + hookID + '?access_token=' + this._access_token,
			method: 'DELETE',
			json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (body && body.ok) {
				console.log('Successfully deleted webhook!');
				dfd.resolve(body);
			} else if (body && body.error) {
				dfd.reject(body.error);
			}
		});

		return dfd.promise;
	},

	listWebhooks: function () {
		var that = this;
		var dfd = when.defer();
		request({
			uri: this.baseUrl + '/v1/webhooks/?access_token=' + this._access_token,
			method: 'GET', json: true
		}, function (error, response, body) {
			if (error) {
				return dfd.reject(error);
			}
			if (that.hasBadToken(body)) {
				return dfd.reject('Invalid token');
			}
			dfd.resolve(body);
		});

		return dfd.promise;
	},



	hasBadToken: function(body) {
		if (body && body.error && body.error.indexOf
			&& (body.error.indexOf('invalid_token') >= 0)) {
			console.log();
			console.log(chalk.red('!'), 'Please login - it appears your access token may have expired');
			console.log();
			return true;
		}
		return false;
	}
};

module.exports = ApiClient;
