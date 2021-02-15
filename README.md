# homebridge-piazzetta-stove-simple
Homebridge plugin to control Piazzetta pellets stove (with Micronova's WiFi module and associated Efesto Web service account) from iOS/HomeKit.

| :warning: WARNING          |
|:---------------------------|
| Piazzetta (Micronova?) is dropping and deprecating the "Q030" (white) external WiFi module, as well as associated mobile app, web service, etc. They should all cease to work somewhere in 2021, and Piazzetta is freely replacing such modules by a successor one (Micronova Aqua-IOT "WiFi Navel 2.0"). This repository is being archived as a consequence, and another module might be developed for Homebridge. |

## Supported stoves
As of now, only "Trend Line" Piazzetta stoves from 2017+ with a Piazzetta WiFi module and associated official app account are known to be supported.  
In theory, lots of models with Micronova mother board and WiFi module could be supported, even for non-Piazzetta brands.  
If you tested the module with a model which is not listed here, and that everything is working as expected, feel free to inform in an issue.

## Capabilities and limitations

The module runs as an homebridge "Heater Cooler" device type, as it is the only fit one from HomeKit available interfaces; with specific tricks to expose it as a heating only device.  
The modules allows for powering ON/OFF, setting target temperature, and flame/flow power. 

The flame/flow power is set through "Fan Rotation Speed" (but is correctly stepped, an can range from 1 to 4), as this is the only available control to set such continuous multi-values settings within HomeKit.  
As elementary Piazzetta stoves do not support air flow swinging or physical commands lock, these HomeKit controls are disabled and should not appear in HomeKit (however, due to a bug in HomeKit, the "Fan Swinging" option may still appear).  
Temperature is set to be displayed in Celsius degrees. Non-international units may be easily supported if the request if made.    
A power-state swing protection mechanism prevents any power-state order (ON or OFF) to be passed to the stove if it is in target state already, or if last power-state change from HomeKit occurred within 60 minutes. Otherwise, automatic HomeKit requests to power ON/OFF just to sync app widgets and device would end-up over-heating the stove for nothing, and triggering its self-protection.    
Any "idle" like status (flame waiting, lighting, standby, cleaning, etc.) will be represented as device ON and status badge "IDLE" (green) in HomeKit.  
Any regular heating status (working, heating) will be represented as device ON and status badge "HEATING" (orange) in HomeKit.  
Any other status is considered as the device being OFF/inactive.

Some status refreshes might not be honored as quickly as HomeKit would like, and the "Unresponsive" message might appear sometimes:
- first the Homebridge use scenario is by itself limiting responsiveness to HomeKit, and you might encounter the same behavior with other devices,
- the more devices and plugins you have, the more Homebridge will take time to update devices status,
- the Efesto Web API, which the Piazzetta stoves' WiFi module use and this module relies on, was not designed to run at scale, and is often unresponsive, if working at all. As so, some requests will fail (just as in official app).

None of known limitations are preventing the module/plugin to integrate your home automation with HomeKit, and to be able to support most simple scenarios, the main one being remotely starting/stopping your stove based on conditions or manually.

## Plugin Installation
Via NPM (or within Homebridge Plugins tab): `npm install -g homebridge-piazzetta-stove-simple`

## Settings

The plugin configuration is done via Homebridge UI plugins settings and is documented.  
The result is saved in config as follows:
```
{
    "name": "<stove friendly name>",
    "login": "<Efesto/Piazzetta Wifi Module app login email>",
    "password": "<Efesto/Piazzetta Wifi Module app password>",
    "id": "<WiFi module ID: MAC address in upper-case without separators>",
    "accessory": "HeaterCoolerPiazzettaStoveSimple"
}
```

## Association

As the module is an accessory one, once plugin configuration is done and Homebridge restarted, the stove should appear in HomeKit without any further setup.
