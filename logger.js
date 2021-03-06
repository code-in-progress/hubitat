const WebSocket = require('ws');
const fs = require('fs');
const path_util = require('path');
const sprintf = require('sprintf-js').sprintf;
const assert = require('assert');
const debug = require('./writers/debug.js');

var config = require('./config.json');

if(config_checks()) {
    global.config = config;
    global.debug = config.app.debug;
    var subscriptions = config.hub.events.subscriptions;
}
else {
    process.exit(1);
}

var hub = config.hub;
var events = hub.events;
var logs = hub.logs;

global.hub = config.hub;
global.events = hub.events;
global.logs = hub.logs;

var webserver = config.app.webserver;
if(webserver.enable) {
    const express = require('express');
    const server = express();
    const bodyParser = require('body-parser')
    
    server.use(bodyParser.urlencoded({ extended: false }));

    server.post('/select_devices', function(req, res) {
        var html = '<html><title>Selected Devices</title><body><div>You selected the following devices:</div>';
        
        fs.writeFile("config.json.bak", JSON.stringify(config, null, 2), function (err) {
            if (err)
                throw err;
        });
        
        subscriptions = [];

        for(var device in req.body) {
            subscriptions.push(parseInt(req.body[device]));
            html += '<div>' + device + '</div>';
        }
        
        delete require.cache[require.resolve('./config.json')];

        fs.writeFile("config.json", JSON.stringify(config, null, 2), function (err) { });
        html += '<div><br/><br/>Your configuration has been saved and your previous configuration has been saved to config.json.bak.</body></html>';
        
        res.send(html);
    });

    server.get('/get_devices', function (req, res) {
        const request = require('request');

        request(webserver.maker_api_url, { json: true }, (err, resp, body) => {
            if (err) { return console.log(err); }
            var html = '<html><title>Select Devices</title><style type="text/css">font-family:verdana; font-size: 10pt;</style><body><h4>Please select your devices below:</h4><br/><form method="POST" action="select_devices">';

            for(var d in body) {
                var device = body[d];
                
                var index = subscriptions.indexOf(parseInt(device.id));

                html += "<input type=\"checkbox\" id=\"" + device.label + "\" name=\"" + device.label + "\" value=\"" + device.id + "\"" + (index !== -1 ? " checked " : "") + ">" + device.label + "<br/>";
                
            }
            html += '<input type="submit" /></form></body></html>';
            res.send(html);
        });
    });
    
    server.listen(webserver.port);
    console.log('Listening on port ' + webserver.port);
}

//Setup the listener for the events websocket.
if(events.enabled) {
    var con = sprintf('ws://%s/%s', hub.hub_host, events.socket_name);
    var ws = getSocket(con);
    
    ws.on('open', function(err) {
        if (err) throw err;
        if(global.debug) console.log("Waiting on events");
    });
    
    ws.on('message', function incoming(data) {
        var out_data = getEventData(JSON.parse(data));
        var writers = events.writers;
        
        if(subscriptions !== null && Array.isArray(subscriptions) && subscriptions.length > 0) {
            inSubs = subscriptions.indexOf(out_data.deviceId) !== -1;
        }
        else { inSubs = true; }
        
        if(inSubs) {
            for(var w in writers) {
                var writer = writers[w];
                if(writer.enable) {
                    var o = require(writer.module);
                    o.write(out_data, writer);
                }
            }
        }
    });
}

if(logs.enabled) {
    var con = sprintf('ws://%s/%s', hub.hub_host, logs.socket_name);
    var ws = getSocket(con);
    
    ws.on('message', function incoming(data) {
        var out_data = getLogData(JSON.parse(data));

        if(global.debug) console.log("Waiting on events");
        
        var writers = logs.writers;

        for(var w in writers) {
            var writer = writers[w];
            if(writer.enable) {
                var o = require(writer.module);
                o.write(out_data, writer);
            }
        }
    });
}

function getSocket(connection) {
    return new WebSocket(connection);
}

function getEventData(data) {
    var ts = Date.now();
    var hsts = new Date().toString();
    
    var return_data = {
        source: data.source,
        name: data.name,
        displayName: data.displayName,
        value: data.value,
        unit: data.unit,
        deviceId: data.deviceId,
        hubId: data.hubId,
        locationId: data.locationId,
        installedAppId: data.installedAppId,
        descriptionText: data.descriptionText,
        timestamp: ts,
        date: hsts
    };

    return return_data;
}

function getLogData(data) {
    var return_data = {
        name: data.name,
        msg: data.msg,
        id: data.id,
        time: data.time,
        type: data.type,
        level: data.level
    };

    return return_data;
}

// process.on('uncaughtException', (err) => {
//     console.error('There was an uncaught error', err);
//     process.exit(1);
// });

function config_checks() {
    var host = config.hub;
    var msg = [];
    console.log("Checking configuration");

    if(!host.events.enabled && !host.logs.enabled) {
        msg.push("Events or Logs must be enabled (host: { events: { enabled: true|false } } { logs: { enabled: true|false } })");
    }

    if(host.events.enabled) {
        if(host.events.socket_name === undefined || host.events.socket_name == '') {
            msg.push("Socket name is required for events. Please set the socket name to 'eventsocket' (or whatever the current name is).");
        }
        
        if(host.events.writers === undefined || host.events.writers.length == 0) {
            msg.push("No event writers have been defined.");
        }
    }

    if(host.logs.enabled) {
        if(host.logs.socket_name === undefined || host.logs.socket_name == '') {
            msg.push("Socket name is required for logs. Please set the socket name to 'logsocket' (or whatever the current name is).");
        }
        
        if(host.logs.writers === undefined || host.logs.writers == 0) {
            msg.push("No log writers have been defined.");
        }
    }

    if(msg.length > 0) {
        msg.forEach(function(m) {
            console.log(m);
        });
        return false;
    }
    else { console.log("Configuration check passed"); return true; }
}