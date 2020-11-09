# homebridge-piazzetta-stove-simple
Homebridge plugin to control Piazzetta pellets stove via Micronova's WiFi module and associated Efesto Web service.

## Supported stoves
From now, only "Trend Line" Piazzetta stoves from 2017+ with a Piazzetta WiFi module and control app are known to be supported.  
In theory, lots of models with Micronova mother board and WiFi module could be supported, even for non-Piazzetta models.  
If you tested the module with a model which is not listed here, but that is working, feel free to drop an issue.

## Capabilities and limitations

The module runs as an homebridge "Heater Cooler" device type, with specific limitations for it to work as a heater device only.  
The modules allows for powering ON/OFF, setting target temperature, and flame/flow power. 

The flame/flow power is set through "fan rotation speed" (but is correctly stepped, an can range from 1 to 3), as this is the only available control to set such continuous multi-values settings within HomeKit.  
As elementary Piazzetta stoves do not support air flow swinging or physical commands lock, these HomeKit controls are disabled and should not appear in HomeKit (however, due to a bug in HomeKit, the "Fan Swinging" option may still appear).  
Temperature is set to be displayed in Celsius degrees.  
A power-state mess protection mechanism prevents any power-state order (ON or OFF) to be passed to the stove if it is in target state already, or if last power-state change occurred within 90 minutes (as recommended by Piazzetta).  
Any "idle" like status (flame waiting, standby, cleaning, etc.) will be represented as device ON and status badge "IDLE" (green) in HomeKit.  
Any regular heating status (working) will be represented as device ON and status badge "HEATING" (orange) in HomeKit.  
Any other status is considered as the device being OFF/inactive.

## Plugin Installation
Via NPM (or within Homebridge Plugins tab): `npm install -g homebridge-piazzetta-stove-simple`

## Settings

The plugin configuration is done via Homebridge UI plugins settings.
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

As the module is an accessory one, once plugin configuration is set and Homebridge restarted, the stove should appear in HomeKit without any further setup.
