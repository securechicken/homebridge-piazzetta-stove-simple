/*
homebridge-piazzetta-stove-simple
Homebridge plugin to control Piazzetta pellets stove via Micronova's WiFi module.
Licensed under AGPL-3.0-only License [https://www.gnu.org/licenses/agpl-3.0.en.html].
Copyright (C) 2020, @securechicken
*/

const PLUGIN_NAME = "homebridge-piazzetta-stove-simple";
const PLUGIN_AUTHOR = "@securechicken";
const PLUGIN_VERSION = "0.1.0";
const PLUGIN_DEVICE_MANUFACTURER = "Piazzetta";
const PLUGIN_DEVICE_MODEL = "Piazzetta Stove";
const ACCESSORY_PLUGIN_NAME = "HeaterCoolerPiazzettaStoveSimple";

const fetch = require("node-fetch");
const https = require("https");

module.exports = (api) => {
	api.registerAccessory(ACCESSORY_PLUGIN_NAME, HeaterCoolerPiazzettaStoveSimple);
};

const HTTP_TIMEOUT = 10000; // The web service is unfortunately very laggy
const HTTP_REQ_COOKIE_HEADER = "Cookie";
const HTTP_REQ_UA_HEADER = "User-Agent";
const HTTP_REP_COOKIE_HEADER = "set-cookie";
const HTTP_UA = "homebridge-piazzetta-stove-simple/" + PLUGIN_VERSION;
const API_PROTOCOL = "https://";
const API_HOSTNAME = "piazzetta.efesto.web2app.it";
const API_MAX_LOGIN_ATTEMPTS = 2;
const API_LOGIN = "/en/login/";
const API_LOGIN_PARAM_LOGIN = "login[username]=";
const API_LOGIN_PARAM_PASSWORD = "login[password]=";
const API_LOGIN_TOKEN_NAME = "remember=";
const API_LOGIN_AUTOLOGIN_DELAY = 86400000; // 24h in millisec
const API_ENDPOINT_FRONTEND = "/en/ajax/action/frontend/response/ajax/";
const API_METHOD_PARAM_TOKEN = API_LOGIN_TOKEN_NAME;
const API_METHOD_PARAM_DEVICE = "device=";
const API_METHOD_PARAM_METHOD = "method=";
const API_METHOD_PARAM_PARAMS = "params=";
const API_METHOD_GET_STATE = "get-state";
const API_METHOD_POWER_ON = "heater-on";
const API_METHOD_POWER_OFF = "heater-off";
const POWER_SWING_PROTECTION_DELAY = 3600000; // 60min in millisec
const API_METHOD_SET_VAL = "write-parameters-queue";
const API_METHOD_TEMP_PARAM = "set-air-temperature=";
const API_METHOD_POWER_PARAM = "set-power=";
const API_RESP_STATUS = "status";
const API_RESP_MESSAGE = "message";
const STOVE_CONNECTION_STATUS_OK = 0;
const STOVE_ALARM_STATUS_OK = 0;
const STOVE_ALARM_AWAITING_FLAME = 32;
const STOVE_MIN_TEMP = 0;
const STOVE_MAX_TEMP = 50;
const STOVE_MIN_TEMP_THRESHOLD = 7;
const STOVE_MAX_TEMP_THRESHOLD = 30;
const STOVE_TEMP_DELTA = 1;
const STOVE_MIN_POWER = 1;
const STOVE_MAX_POWER = 4;
const STOVE_POWER_DELTA = 1;
const STOVE_STATUS_STATE = "deviceStatus";
const STOVE_STATUS_CURRENT_TEMP = "airTemperature";
const STOVE_STATUS_SET_TEMP = "lastSetAirTemperature";
const STOVE_STATUS_CURRENT_POWER = "realPower";
const STOVE_STATUS_SET_POWER = "lastSetPower";
const STOVE_STATUS_TIMESTAMP = "lastCheckTimestamp";
const STOVE_STATUS_ALARM = "isDeviceInAlarm";
const STOVE_STATUS_CONNECTION = "contactStatus";
const STOVE_STATUS_CACHE_KEEP = 10000;

class HeaterCoolerPiazzettaStoveSimple {
	constructor(log, config, api) {
		this.log = log;
		this.config = config;
		this.api = api;
		this.Service = api.hap.Service;
		this.Characteristic = api.hap.Characteristic;
		this.log.debug(ACCESSORY_PLUGIN_NAME + "init, config: " + JSON.stringify(this.config));

		this.isAuth = false;
		this.authToken = null;
		this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
		this.httpHeaders = {};
		this.httpHeaders[HTTP_REQ_UA_HEADER] = HTTP_UA;
		this.httpHeaders[HTTP_REQ_COOKIE_HEADER] = this.authToken;
		this.status = {};
		this.status[STOVE_STATUS_STATE] = 0;
		this.status[STOVE_STATUS_CURRENT_TEMP] = STOVE_MIN_TEMP;
		this.status[STOVE_STATUS_SET_TEMP] = STOVE_MIN_TEMP_THRESHOLD;
		this.status[STOVE_STATUS_CURRENT_POWER] = STOVE_MIN_POWER;
		this.status[STOVE_STATUS_SET_POWER] = STOVE_MIN_POWER;
		this.status[STOVE_STATUS_TIMESTAMP] = null;
		this.statusStateMap = new Map([
			[0, this.Characteristic.CurrentHeaterCoolerState.INACTIVE], // OFF, OFF E
			[1, this.Characteristic.CurrentHeaterCoolerState.IDLE], // TURNING OFF, AWAITING FLAME (+ ERROR 32)
			[2, this.Characteristic.CurrentHeaterCoolerState.IDLE],
			[3, this.Characteristic.CurrentHeaterCoolerState.IDLE], // LIGHTING
			[4, this.Characteristic.CurrentHeaterCoolerState.HEATING], // WORRKING
			[5, this.Characteristic.CurrentHeaterCoolerState.IDLE],
			[6, this.Characteristic.CurrentHeaterCoolerState.IDLE], // FINAL CLEANING
			[7, this.Characteristic.CurrentHeaterCoolerState.IDLE] // STANDBY
		]);
		this.statusActiveMap = new Map([
			[0, this.Characteristic.Active.INACTIVE],
			[1, this.Characteristic.Active.ACTIVE],
			[2, this.Characteristic.Active.ACTIVE],
			[3, this.Characteristic.Active.ACTIVE],
			[4, this.Characteristic.Active.ACTIVE],
			[5, this.Characteristic.Active.ACTIVE],
			[6, this.Characteristic.Active.ACTIVE],
			[7, this.Characteristic.Active.ACTIVE]
		]);
		this.lastPowerChange = null;

		this._autoLoginWrapper(true);
		setInterval( this._autoLoginWrapper.bind(this), API_LOGIN_AUTOLOGIN_DELAY, false);

		// Device infos
		this.infoService = new this.Service.AccessoryInformation();
		this.infoService
			.setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_DEVICE_MANUFACTURER)
			.setCharacteristic(this.Characteristic.Model, PLUGIN_DEVICE_MODEL)
			.setCharacteristic(this.Characteristic.Name, this.config.name)
			.setCharacteristic(this.Characteristic.SerialNumber, this.config.id)
			.setCharacteristic(this.Characteristic.SoftwareRevision, PLUGIN_VERSION)
			.setCharacteristic(this.Characteristic.FirmwareRevision, PLUGIN_NAME)
			.setCharacteristic(this.Characteristic.HardwareRevision, PLUGIN_AUTHOR);

		// Heater Cooler service
		const sname = this.config.name || ACCESSORY_PLUGIN_NAME;
		this.service = new this.Service.HeaterCooler(sname);

		// Set characteristics properties boundaries and valid values
		// Setting CurrentHeaterCoolerState and TargetHeaterCoolerState allows to
		// lock device to heater mode only
		this.service.getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
			.setProps({
				minValue: this.Characteristic.CurrentHeaterCoolerState.INACTIVE,
				maxValue: this.Characteristic.CurrentHeaterCoolerState.HEATING,
				validValues: [this.Characteristic.CurrentHeaterCoolerState.INACTIVE, this.Characteristic.CurrentHeaterCoolerState.IDLE, this.Characteristic.CurrentHeaterCoolerState.HEATING]
			});
		this.service.getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
			.setProps({
				minValue: this.Characteristic.TargetHeaterCoolerState.HEAT,
				maxValue: this.Characteristic.TargetHeaterCoolerState.HEAT,
				validValues: [this.Characteristic.TargetHeaterCoolerState.HEAT]
			});
		this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
			.setProps({minValue: STOVE_MIN_TEMP, maxValue: STOVE_MAX_TEMP, minStep: STOVE_TEMP_DELTA});
		this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
			.setProps({minValue: STOVE_MIN_TEMP_THRESHOLD, maxValue: STOVE_MAX_TEMP_THRESHOLD, minStep: STOVE_TEMP_DELTA});
		this.service.getCharacteristic(this.Characteristic.RotationSpeed)
			.setProps({minValue: STOVE_MIN_POWER, maxValue: STOVE_MAX_POWER, minStep: STOVE_POWER_DELTA});
		this.service.getCharacteristic(this.Characteristic.LockPhysicalControls)
			.setProps({
				minValue: this.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED,
				maxValue: this.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED,
				validValues: [this.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED]
			});
		this.service.getCharacteristic(this.Characteristic.SwingMode)
			.setProps({
				minValue: this.Characteristic.SwingMode.SWING_DISABLED,
				maxValue: this.Characteristic.SwingMode.SWING_DISABLED,
				validValues: [this.Characteristic.SwingMode.SWING_DISABLED]
			});
		this.service.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
			.setProps({
				minValue: this.Characteristic.TemperatureDisplayUnits.CELSIUS,
				maxValue: this.Characteristic.TemperatureDisplayUnits.CELSIUS,
				validValues: [this.Characteristic.TemperatureDisplayUnits.CELSIUS]
			});

		// Forced initial arbitrary states
		this.service.setCharacteristic(this.Characteristic.Name, this.config.name);
		this.service.setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
		this.service.setCharacteristic(this.Characteristic.CurrentHeaterCoolerState, this.Characteristic.CurrentHeaterCoolerState.INACTIVE);
		this.service.setCharacteristic(this.Characteristic.TargetHeaterCoolerState, this.Characteristic.TargetHeaterCoolerState.HEAT);
		this.service.setCharacteristic(this.Characteristic.TemperatureDisplayUnits, this.Characteristic.TemperatureDisplayUnits.CELSIUS);
		this.service.setCharacteristic(this.Characteristic.CurrentTemperature, STOVE_MIN_TEMP);
		this.service.setCharacteristic(this.Characteristic.HeatingThresholdTemperature, STOVE_MIN_TEMP_THRESHOLD);
		this.service.setCharacteristic(this.Characteristic.LockPhysicalControls, this.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
		this.service.setCharacteristic(this.Characteristic.SwingMode, this.Characteristic.SwingMode.SWING_DISABLED);
		this.service.setCharacteristic(this.Characteristic.RotationSpeed, STOVE_MIN_POWER);

		// Services methods and events handling
		this.service.getCharacteristic(this.Characteristic.Active)
			.on("get", this.getStoveActive.bind(this))
			.on("set", this.setStoveActive.bind(this));
		this.service.getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
			.on("get", this.getStoveState.bind(this));
		this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
			.on("get", this.getStoveCurrentTemp.bind(this));
		this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
			.on("get", this.getStoveSetTemp.bind(this))
			.on("set", this.setStoveTemp.bind(this));
		this.service.getCharacteristic(this.Characteristic.RotationSpeed)
			.on("get", this.getStovePower.bind(this))
			.on("set", this.setStovePower.bind(this));

		this.log.debug("Finished loading, status: " + JSON.stringify(this.status));
	}

	// Mandatory services export method
	getServices() {
		return [this.infoService, this.service];
	}

	// API login helper
	_sendAPILogin(callback) {
		this.httpHeaders[HTTP_REQ_COOKIE_HEADER] = null;
		this.isAuth = false;
		let url = API_LOGIN + "?" + API_LOGIN_PARAM_LOGIN + this.config.login + "&" + API_LOGIN_PARAM_PASSWORD + this.config.password;
		fetch(API_PROTOCOL + API_HOSTNAME + url, {timeout: HTTP_TIMEOUT, agent: this.httpsAgent, headers: this.httpHeaders, redirect: "manual"})
			.then( (resp) => {
				if (resp.headers) {
					this.log.debug("_sendAPILogin got a response with headers");
					return resp.headers.raw()[HTTP_REP_COOKIE_HEADER];
				} else {
					this.log.debug("_sendAPILogin got a response with NON-OK status");
					this.authToken = null;
					throw new Error("Authentication rejected by API:" + resp.status);
				}
			})
			.then( (cookies) => {
				let token = null;
				if (cookies && Array.isArray(cookies) && cookies.length >= 1) {
					for (const cookie of cookies) {
						if (cookie.startsWith(API_LOGIN_TOKEN_NAME)) {
							let commaSplit = cookie.split(";");
							let equalSplit = commaSplit[0].split("=");
							if (API_LOGIN_TOKEN_NAME.startsWith(equalSplit[0]) && equalSplit.length >= 1) {
								token = equalSplit[1];
								this.log.debug("_sendAPILogin retrieved a token: " + token);
							}
						}
					}
				}
				if (token) {
					this.isAuth = true;
					this.authToken = token;
					callback(null, token);
				} else {
					throw new Error("API did not send a token back: " + JSON.stringify(cookies));
				}
			})
			.catch( (err) => {
				this.authToken = null;
				callback(err.message, null);
			});
	}

	_autoLoginWrapper(isInitCall) {
		for (let attempt = 1; attempt <= API_MAX_LOGIN_ATTEMPTS; attempt++) {
			const init = isInitCall;
			const attemptc = attempt;
			if (init) {
				this.log.info("First log-in (attempt " + attemptc + ")");
			} else {
				this.log.info("Attempting auto log-in (attempt " + attemptc + ")");
			}
			this._sendAPILogin( (err, token) => {
				if (token || !err) {
					if (init) {
						this.log.info("Successfully logged-in: " + token);
					} else {
						this.log.info("Successfully logged-in automatically after set delay: " + token);
					}
				} else {
					this.log.error("Attempt " + attemptc + ": could not log-in with login '" + this.config.login + "': " + err);
				}
			} );
		}
	}

	// Send remote key to player network remote API
	_sendAPIRequest(url, callback) {
		if (this.isAuth) {
			this.httpHeaders[HTTP_REQ_COOKIE_HEADER] = API_METHOD_PARAM_TOKEN + this.authToken;
			this.log.debug("_sendAPIRequest will send to: " + url + ", with headers: " + JSON.stringify(this.httpHeaders));
			fetch(API_PROTOCOL + API_HOSTNAME + url, {timeout: HTTP_TIMEOUT, agent: this.httpsAgent, headers: this.httpHeaders})
				.then( (resp) => {
					if (resp.ok || resp.status === 302) {
						this.log.debug("_sendAPIRequest got a response with OK status");
						return resp;
					} else {
						this.log.debug("_sendAPIRequest got a response with NON-OK status");
						throw new Error("Non-OK HTTP Response Status received:" + resp.status);
					}
				})
				.then( resp => resp.json() )
				.then( (json) => {
					if (json && json[API_RESP_STATUS] === 0 && json[API_RESP_MESSAGE]) {
						this.log.debug("_sendAPIRequest got a JSON response with OK status");
						callback(null, json[API_RESP_MESSAGE]);
					} else if (json && json[API_RESP_STATUS] === 1 && json[API_RESP_MESSAGE]) {
						this.log.debug("_sendAPIRequest got a JSON response with NON-OK status");
						throw new Error("API Error: " + json[API_RESP_MESSAGE]);
					} else {
						throw new Error("Unspecified Error: " + JSON.stringify(json));
					}
				})
				.catch( err => callback(err.message, null) );
		} else {
			callback("Not logged-in...", null);
		}
	}

	// Method API request helper
	_sendAPIMethod(method, params, callback) {
		let url = API_ENDPOINT_FRONTEND + "?" + API_METHOD_PARAM_DEVICE + this.config.id + "&" + API_METHOD_PARAM_METHOD + method;
		if (params) {
			url += "&" + API_METHOD_PARAM_PARAMS + params;
		}
		this.log.debug("_sendAPIMethod will send " + method + ", " + params);
		this._sendAPIRequest(url, (err, res) => {
			if (res || !err) {
				this.log.debug("_sendAPIMethod got a response: " + JSON.stringify(res));
				callback(null, res);
			} else {
				this.log.debug("_sendAPIMethod failed to run '" + method + "': " + err);
				callback(err, null);
			}
		});
	}

	// Status cache filling helper
	_fillStatusCache(status, callback) {
		try {
			this.status[STOVE_STATUS_STATE] = status[STOVE_STATUS_STATE];
			this.status[STOVE_STATUS_CURRENT_TEMP] = status[STOVE_STATUS_CURRENT_TEMP];
			this.status[STOVE_STATUS_SET_TEMP] = status[STOVE_STATUS_SET_TEMP];
			this.status[STOVE_STATUS_CURRENT_POWER] = status[STOVE_STATUS_CURRENT_POWER];
			this.status[STOVE_STATUS_SET_POWER] = status[STOVE_STATUS_SET_POWER];
			this.status[STOVE_STATUS_ALARM] = status[STOVE_STATUS_ALARM];
			if ( (status[STOVE_STATUS_ALARM] !== STOVE_ALARM_STATUS_OK) && (status[STOVE_STATUS_ALARM] !== STOVE_ALARM_AWAITING_FLAME)) {
				this.log.warn("Stove alarm is set: " + status[STOVE_STATUS_ALARM]);
			}
			this.status[STOVE_STATUS_CONNECTION] = status[STOVE_STATUS_CONNECTION];
			if (status[STOVE_STATUS_CONNECTION] !== STOVE_CONNECTION_STATUS_OK) {
				this.log.warn("Possible stove WiFi module connection error: " + status[STOVE_STATUS_CONNECTION]);
			}
			this.status[STOVE_STATUS_TIMESTAMP] = Date.now();
			this.log.info("Stove status updated: " + JSON.stringify(this.status));
			callback(null, true);
		} catch (ex) {
			this.log.error("Failed to parse stove status: " + ex.message);
			callback(ex, null);
		}
	}

	// Get current stove status if cache expired
	_getStoveStatus(callback) {
		if( (this.status[STOVE_STATUS_TIMESTAMP] + STOVE_STATUS_CACHE_KEEP) >= Date.now() ) {
			this.log.debug("Stove status served from cache: " + JSON.stringify(this.status));
			callback(null, true);
		} else {
			this._sendAPIMethod(API_METHOD_GET_STATE, null, (err, status) => {
				if (status || !err) {
					this._fillStatusCache(status, callback);
				} else {
					this.log.error("Failed to get stove status: " + err);
					callback(err, null);
				}
			});
		}
	}

	// Get ON/OFF state
	getStoveActive(callback) {
		let active = this.Characteristic.Active.INACTIVE;
		this._getStoveStatus(
			(err, ok) => {
				if (ok || !err) {
					if ( (this.status[STOVE_STATUS_CONNECTION] === STOVE_CONNECTION_STATUS_OK) && ((this.status[STOVE_STATUS_ALARM] === STOVE_ALARM_STATUS_OK) || (this.status[STOVE_STATUS_ALARM] === STOVE_ALARM_AWAITING_FLAME)) ) {
						active = this.statusActiveMap.get(this.status[STOVE_STATUS_STATE]);
					}
					this.log.debug("getStoveActive: " + this.status[STOVE_STATUS_STATE] + ", " + this.status[STOVE_STATUS_CONNECTION] + ", " + this.status[STOVE_STATUS_ALARM] + " => " + active);
				} else {
					this.log.error("getStoveActive failed: " + err);
				}
				callback(err, active);
			});
	}

	// Set ON/OFF
	setStoveActive(state, callback) {
		let method = API_METHOD_POWER_OFF;
		if (state == this.Characteristic.Active.ACTIVE) {
			method = API_METHOD_POWER_ON;
		}
		let dn = Date.now();
		if ( this.statusActiveMap.get(this.status[STOVE_STATUS_STATE]) == state ) {
			this.log.debug("Stove power swing protection: stove already at target state: " + state + " => " + this.statusActiveMap.get(this.status[STOVE_STATUS_STATE]));
			callback(null);
		} else if ( (dn - this.lastPowerChange) <= POWER_SWING_PROTECTION_DELAY ) {
			let msg = "Stove power swing protection: last power change is too close in time (now " + dn + " vs. last change " + this.lastPowerChange + ")";
			this.log.warn(msg);
			callback(msg);
		} else {
			this._sendAPIMethod(method, null, (err, message) => {
				if (message || !err) {
					this.service.updateCharacteristic(this.Characteristic.Active, state);
					this.lastPowerChange = Date.now();
					this.log.info("Set stove to power " + state + ": " + JSON.stringify(message));
					this._fillStatusCache(message, (ex, ok) => {
						if (ok || !ex) {
							this.log.debug("Filled stove status from setStoveActive result");
						}
					});
					callback(null);
				} else {
					this.log.error("Failed to set stove power: " + err);
					callback(err);
				}
			});
		}
	}

	// Get running state (more precise than ON/OFF)
	getStoveState(callback) {
		let state = this.Characteristic.CurrentHeaterCoolerState.INACTIVE;
		this._getStoveStatus(
			(err, ok) => {
				if (ok || !err) {
					if (this.status[STOVE_STATUS_CONNECTION] === STOVE_CONNECTION_STATUS_OK) {
						state = this.statusStateMap.get(this.status[STOVE_STATUS_STATE]);
					}
					this.log.debug("getStoveState: " + this.status[STOVE_STATUS_STATE] + ", " + this.status[STOVE_STATUS_CONNECTION] + ", " + this.status[STOVE_STATUS_ALARM] + " => " + state);
				} else {
					this.log.error("getStoveState failed: " + err);
				}
				callback(err, state);
			});
	}

	// Get stove measured air temp
	getStoveCurrentTemp(callback) {
		let temp = STOVE_MIN_TEMP;
		this._getStoveStatus(
			(err, ok) => {
				if (ok || !err) {
					temp = this.status[STOVE_STATUS_CURRENT_TEMP];
					this.log.debug("getStoveCurrentTemp: " + temp);
				} else {
					this.log.error("getStoveCurrentTemp failed: " + err);
				}
				callback(err, temp);
			});
	}

	// Get threshold temperature from which to power on heating
	getStoveSetTemp(callback) {
		let temp = STOVE_MIN_TEMP_THRESHOLD;
		this._getStoveStatus(
			(err, ok) => {
				if (ok || !err) {
					temp = this.status[STOVE_STATUS_SET_TEMP];
					this.log.debug("getStoveSetTemp: " + temp);
				} else {
					this.log.error("getStoveSetTemp failed: " + err);
				}
				callback(err, temp);
			});
	}

	// Set threshold temperature from which to power on heating
	setStoveTemp(temp, callback) {
		let correctedtemp = temp;
		if (temp > STOVE_MAX_TEMP_THRESHOLD) {
			correctedtemp = STOVE_MAX_TEMP_THRESHOLD;
		}
		if (temp < STOVE_MIN_TEMP_THRESHOLD) {
			correctedtemp = STOVE_MIN_TEMP_THRESHOLD;
		}
		this.log.debug("setStoveTemp: " + temp + " => " + correctedtemp);
		this._sendAPIMethod(API_METHOD_SET_VAL, API_METHOD_TEMP_PARAM + correctedtemp, (err, message) => {
			if (message || !err) {
				this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, correctedtemp);
				this.log.info("Set stove heating temp to " + correctedtemp + ": " + JSON.stringify(message));
				callback(null);
			} else {
				this.log.error("Failed to set stove heating temp: " + err);
				callback(err);
			}
		});
	}

	// Get stove current running power
	getStovePower(callback) {
		let power = STOVE_MIN_POWER;
		this._getStoveStatus(
			(err, ok) => {
				if (ok || !err) {
					power = this.status[STOVE_STATUS_SET_POWER];
					this.log.debug("getStovePower: " + power);
				} else {
					this.log.error("getStovePower failed: " + err);
				}
				callback(err, power);
			});
	}

	// Set stove running power
	setStovePower(power, callback) {
		let correctedpower = power;
		if (power > STOVE_MAX_POWER) {
			correctedpower = STOVE_MAX_POWER;
		}
		if (power < STOVE_MIN_POWER) {
			correctedpower = STOVE_MIN_POWER;
		}
		this.log.debug("setStovePower: " + power + " => " + correctedpower);
		this._sendAPIMethod(API_METHOD_SET_VAL, API_METHOD_POWER_PARAM + correctedpower, (err, message) => {
			if (message || !err) {
				this.service.updateCharacteristic(this.Characteristic.RotationSpeed, correctedpower);
				this.log.info("Set stove power to " + correctedpower + ": " + JSON.stringify(message));
				callback(null);
			} else {
				this.log.error("Failed to set stove power: " + err);
				callback(err);
			}
		});
	}
}
