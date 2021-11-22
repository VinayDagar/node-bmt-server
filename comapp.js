// const PubNub = require('pubnub');
const http = require('http');
const httpfs = require('fs')
const serverIP = ''
var WebSocketClient = require('websocket').client;

//////////////////////////////////////////////////
//// Websocket Client example
//////////////////////////////////////////////////

var client = new WebSocketClient();

// messages
const appCmdDevConnect = 0;              // open new connection with device
const appCmdDevDisconnect = 1;           // close connection with device
const appCmdDevEvent = 2;                // events from device
const appCmdDevReadAuditFile = 3;        // command to read audit file protocols in xml format
const appCmdDevReadFileProgress = 4;     // command to reading status indicator progress in "%"
const appCmdDevReadProtocolFile = 5;     // command to file protocols in prt binary format
const appCmdDevReadProtocolFormated = 6; // command to file protocols in prt xml or json format
const appCmdDevState = 7;                // device state in xml or json
const appCmdDevAuditHistory = 8;         // read audit trail log history
const appCmdCount = 9;
const appReadAndDeploy = 10;

const appCmdConnectToBMTServer = 100;    // Connect to BMTCommServer
const appCmdDisconnectFromBMTServer = 101;// Dissconnect from BMTCommServer


// devtypes
const _devSterivap = "0";
const _devUnisteri = "1";
const _devSterivapSL = "2";
const _devUnisteri2021 = "3";
let readAndDeployData = false;

// read audit file result codes
const _actOK = 0; 			    // result is ok
const _actNotConnected = 1; // handle is not open
const _actBussy = 2;        // can’t read Audit Trail (file system is busy or reading progress)
const _actNoReady = 3;      // device is not ready to read AuditTrail records
const _actNotFound = 4;     // file does not exist
const _actFail = 5;		      // operation failed

// ext events from Sterilizator
const  _eventExtSysFSState = 0 ;  // event filesystem ready state - used only for old Sterivap: 
                                  // arguments: 
                                  // arg(0): - 0 - panel is ready to read protocol files from SD card; 0 - panel is not ready to read protocol files from SD card;
                                  // arg(1): - conID
const  _eventExtSysPrtCharge = 1; // new charge completed - arguments: arg(0) - charge, arg(1) - time, arg(2) - conID

// for testing use only one instance
var devInst = {
  conID: 0,                 // connection ID
  BMTCommSrvConnection: 0,  // BMTServer web socket connection
  ip: '10.10.1.226',        // 
  statusData: "",
  state: appCmdDevConnect,
  downCharge: 115,
  prtContent: "",
  tmcounter: 5,
  // parsed
  progState:0,
  charge: 0,

  // devstate
  devInfo: "",
  devProgram: "",
  devAnalogs: "",
  devMessages: "",
  User1: "",
  User2: "",

  // protocol
  protocoData: "",

};

// cmd = appCmd___, argList = ['a', 'b', ...]
function sendCMD(cmd, data, argList) {
  if (devInst.BMTCommSrvConnection && devInst.BMTCommSrvConnection.connected) {
    var request = { 'a': 'cmd', 'args': argList, 'cmd': cmd, 'data': data, 'r': 1 };
    console.log("sending request:" + JSON.stringify(request));
    devInst.BMTCommSrvConnection.send(JSON.stringify(request));
    return 1;
  } else {
    sendWebResponse(cmd, "not connected to BMTCommServer server!", "", 0);
    console.log("not connected to BMTCommServer server!");
    return 0;
  }
}

function getResultText(result) {
  switch (result) {
    case _actOK: return "complete.";
    case _actNotConnected: return "not connected."; // handle is not open
    case _actBussy: return "bussy."; // can’t read Audit Trail (file system is busy or other file instances are use)
    case _actNoReady: return "panel not ready."; // device is not ready to read AuditTrail records
    case _actNotFound: return "file not found."; // record does not exist
    case _actFail: return "read file failed.";  // operation failed
    default: return "result(" + Number(result) + ").";
  }
}



function sendWebResponse(cmd, data, args, conID) {
  // if(cmd === appCmdDevState) {
  //   return devInst.webRes.json(JSON.stringify({
  //     data, args, conID
  //   }));
  // }

  if (devInst) {
    if (devInst.webRes && !devInst.webRes.finished) {
      // send web response
      var response = { 'cmd': cmd, 'data': data, 'args': args, 'conID': conID };

      console.log("send web response: "); //  + JSON.stringify(response)

      devInst.webRes.writeHead(200, {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      });
      devInst.webRes.write(JSON.stringify(response));
      devInst.webRes.end();
      devInst.webRes = null;

    } else {
      console.log("web request not active! cmd: " + cmd);

      // here you can handle ext events, like cmd == appCmdDevEvent...
      
    }
  }
}

client.on('connectFailed', function (error) {
  console.log('Connect Error: ' + error.toString());
  sendWebResponse(appCmdConnectToBMTServer, "failed to connect BMTCommServer: "+error, "", devInst.conID);
});

client.on('connect', function (connection) {
  console.log('WebSocket Client Connected');

  devInst.BMTCommSrvConnection = connection;
  sendWebResponse(appCmdConnectToBMTServer, "Connected.", "", devInst.conID);

  connection.on('error', function (error) {
    console.log("Connection Error: " + error.toString());
    sendWebResponse(appCmdConnectToBMTServer, error.toString(), "", devInst.conID);
    devInst.BMTCommSrvConnection = null;
  });
  connection.on('close', function () {
    console.log('echo-protocol Connection Closed');
    devInst.delay = 5;
    devInst.conID = 0;
    devInst.state = appCmdDevConnect;
    devInst.BMTCommSrvConnection = null;
    sendWebResponse(appCmdConnectToBMTServer, "Connection Closed", "", devInst.conID);
  });
  connection.on('message', function (message) {

    if (message.type === 'utf8') {

      var cmd;

      try {
        cmd = JSON.parse(message.utf8Data).cmd;
      }catch (err) {
        console.error(err)
      }

      // response by cmd from conID
      switch (cmd) {
        case appCmdDevConnect:
          devInst.conID = JSON.parse(message.utf8Data).args[0];  
          console.log('connected to conID: ' + devInst.conID);
          
          devInst.state = appCmdDevState;

          // if command is from web
          if(devInst.conID==0){
            sendWebResponse(appCmdDevConnect, "failed to connect "+JSON.parse(message.utf8Data).data, [JSON.parse(message.utf8Data).args[0]], devInst.conID);
          }else{
            sendWebResponse(appCmdDevConnect, "Connected as conID "+devInst.conID, [JSON.parse(message.utf8Data).args[0]], devInst.conID);
          }
          break;
        case appCmdDevDisconnect:
          console.log('disconnected conID: ' + JSON.parse(message.utf8Data).args[0]);

          // if command is from web
          sendWebResponse(appCmdDevDisconnect, "Disconnected conID "+devInst.conID, [JSON.parse(message.utf8Data).args[0]], devInst.conID);

          devInst.conID = 0;

          break;
        case appCmdDevState:
          devInst.statusData = JSON.parse(message.utf8Data).data;
          if (devInst.statusData.length != 0) {
            const data = parseDevState(devInst.statusData);
            var status =
              devInst.devInfo + '\n' +
              devInst.devProgram + '\n' +
              devInst.devAnalogs + '\n' +
              devInst.devMessages;

            sendWebResponse(appCmdDevState, data, [""], devInst.conID);
          }
          break;
        case appCmdDevReadProtocolFormated:
          var charge = JSON.parse(message.utf8Data).args[0];
          var conID = JSON.parse(message.utf8Data).args[1];
          var res = JSON.parse(message.utf8Data).args[2];
          var prtRes = { protocol: "", graph: "" };

          if (res) {  // result
            if (res == Number(_actOK)) {
              devInst.prtContent = JSON.parse(message.utf8Data).data;
              devInst.protocoData = parseProtocol(devInst.prtContent);
              var prgName = '';
              if(devInst.prtContent){
                prgName = JSON.parse(devInst.prtContent).Program["Name"]["content"];
              }
              prtRes = { protocol: [devInst.protocoData], graph: JSON.parse(devInst.prtContent).data, IOMap: JSON.parse(devInst.prtContent).IOMap, prgName: prgName };  
              sendWebResponse(appCmdDevReadProtocolFormated, prtRes, JSON.parse(message.utf8Data).args, devInst.conID);
            } else {
              console.log('result: ' + getResultText(Number(res)));
              prtRes = { protocol: getResultText(Number(res)), graph: "" };
              sendWebResponse(appCmdDevReadProtocolFormated, prtRes, JSON.parse(message.utf8Data).args, devInst.conID);
            }
          }else{
            prtRes = { protocol: "read protocol failed.", graph: "" };
            sendWebResponse(appCmdDevReadProtocolFormated, prtRes, JSON.parse(message.utf8Data).args, devInst.conID);
          }
          
          break;
        case appCmdDevEvent:     // used in old SterivapHP
          var event = decodeExtEvent(JSON.parse(message.utf8Data).data, JSON.parse(message.utf8Data).args);
          console.log('event from device: ' + event);
          sendWebResponse(appCmdDevEvent, event, JSON.parse(message.utf8Data).args, devInst.conID);
          break;
        default:
          console.log('unknown dev response: ' + JSON.parse(message.utf8Data));
          sendWebResponse(cmd, JSON.parse(message.utf8Data).data, JSON.parse(message.utf8Data).args, devInst.conID);
          break;
      }

      // console.log("Received: '" + message.utf8Data + "'");
    }
  });

  function parseDevState(res) {
    if (res.length == 0) return;

    // Device
    devInst.devInfo = parseDevInfo(res);
    // Program
    devInst.devProgram = parseProgram(res);
    // User1
    devInst.User1 = JSON.parse(res).User1;
    // User2
    devInst.User2 = JSON.parse(res).User2;

    // add user info
    devInst.devInfo += ' U1: '+devInst.User1;
    if(devInst.User2) 
       devInst.devInfo += ' U2: '+devInst.User2;

    // Messages
    devInst.devMessages = parseMessages(res);
    // Analogs      
    devInst.devAnalogs = parseMainAnalogs(res);
    return {
      devInfo: parseDevInfo(res),
      devProgram: parseProgram(res),
      users: [JSON.parse(res).User1, JSON.parse(res).User2],
      devMessages: parseMessages(res),
      devAnalogs: parseMainAnalogs(res)
    }
  }

  function parseMainAnalogs(res) {
    var s = JSON.parse(res).mAnal;
    var k = Object.keys(s);
    var v = Object.values(s);
    var r = "";

    for (var i = 0; i < k.length; i++) {
      r += k[i] + ": " + v[i] + (k[i].substring(0, 2) == String("PE") ? '[kPa]' : '[°C]');
      if (i < k.length - 1) r += ", ";
    }

    return {
      mAnal: s
    };
  }

  //   {
  //     "Device": {
  //         "ADCounter": "-82906516",
  //         "BSPVer": "2.1",
  //         "Charge": "245",
  //         "D1": "36",
  //         "D2": "36",
  //         "DevType": "IMX6X",
  //         "ProgList": "111111101",
  //         "SWVer": "2.10.5",
  //         "SealMed": "1",
  //         "Serial": "B16060",
  //         "State": "0",
  //         "Steam": "1",
  //         "SteamGenOn": "0",
  //         "Time": "1627993909",
  //         "content": "UNISTERI HP",
  //         "lngID": "cs_CZ"
  //     },
  //     "Messages": {
  //         "m0": {
  //             "a": "210",
  //             "a1": "Low Temperature - Sensor Short PT2",
  //             "msg": {
  //                 "L": "",
  //                 "content": "%1 %2",
  //                 "time": "1627994849",
  //                 "type": "2"
  //             }
  //         },
  //         "m1": {
  //             "a": "200",
  //             "a1": "Error 24 V",
  //             "msg": {
  //                 "L": "",
  //                 "content": "%1 %2",
  //                 "time": "1627994851",
  //                 "type": "2"
  //             }
  //         },
  //         "m2": {
  //             "a": "202",
  //             "a1": "Sensor Cut PT1.1",
  //             "msg": {
  //                 "L": "",
  //                 "content": "%1 %2",
  //                 "time": "1627994867",
  //                 "type": "2"
  //             }
  //         },
  //         "m3": {
  //             "a": "204",
  //             "a1": "Sensor Cut PT1.2",
  //             "msg": {
  //                 "L": "",
  //                 "content": "%1 %2",
  //                 "time": "1627994867",
  //                 "type": "2"
  //             }
  //         },
  //         "m4": {
  //             "msg": {
  //                 "L": "System Version Error",
  //                 "content": "11 ",
  //                 "time": "1627994967",
  //                 "type": "2"
  //             }
  //         }
  //     },
  //     "Program": {
  //         "AirDetector": "0",
  //         "BactFilter": "0",
  //         "ChambCont": "1",
  //         "Cycle": "0",
  //         "DoorLogic": "12",
  //         "Estim": "0",
  //         "Index": "1",
  //         "Phase": "",
  //         "PhaseID": "0",
  //         "PrgModif": "1",
  //         "PrgRes": "-1",
  //         "Run": "0",
  //         "content": "Warm up",
  //         "prgNameU": "Nahřátí ggvbbb vgbb ccx xd ccfde"
  //     },
  //     "User1": "openuser",
  //     "User2": "Open User",
  //     "mAnal": {
  //         "PE1.2": "-76.8",
  //         "PE2": "-25.7",
  //         "PE3": "132.9",
  //         "PT3.1": "-13.2"
  //     }
  // }

  function parseDevInfo(res) {
    var s = JSON.parse(res).Device;
    devInst.charge = s.Charge;
    devInst.progState = s.State;

    /*{ <Device Serial="B16060" DevType="IMX6X" SWVer="2.10.5" BSPVer="2.1" State="0" Charge="245" D1="36" D2="36" lngID="cs_CZ" Time="1627993580" Steam="1" SteamGenOn="0" SealMed="1" ADCounter="-82906516" ProgList="111111101">UNISTERI HP</Device> }*/
    // var res = s.Serial + ' ' + s.content + 
    // ' steam(' + (s.Steam == "1" ? s.SteamGenOn : 'unconf') + ')'      
    // ;    // steam gen info
    
    return {
      Device: JSON.parse(res).Device,
      charge: s.Charge,
      progState: s.State
    };
  }

  // program status
  const _MST_ready = 0;
  const _MST_Running = 1;
  const _MST_ProtSigning = 2;
  const _MST_EndOfProgram = 3;

  function getProgState(state) {
    switch (state) {
      default:
      case _MST_ready: return "ready";
      case _MST_Running: return "running";
      case _MST_ProtSigning: return "Program signing";
      case _MST_EndOfProgram: return "Program End";
    }
  }

  function parseProgram(res) {
    var prog = JSON.parse(res).Program;
    // <Program Index="1" Cycle="0" PrgRes="-1" Run="0" Estim="0" Phase="" PhaseID="0" prgNameU="Nahřátí ggvbbb vgbb ccx xd ccfde" PrgModif="1" DoorLogic="12" BactFilter="0" ChambCont="1" AirDetector="0">Warm up</Program>

    // running
  //   "Program": {
  //     "AirDetector": "0",
  //     "BactFilter": "0",
  //     "ChambCont": "1",
  //     "Cycle": "0",
  //     "DoorLogic": "12",
  //     "Estim": "110",
  //     "Index": "2",
  //     "Phase": "Evacuation 1",
  //     "PhaseID": "1",
  //     "PrgModif": "0",
  //     "PrgRes": "-1",
  //     "PrgStart": "1628177084",
  //     "Run": "66",
  //     "content": "Universal",
  //     "prgNameU": "Univerzal"
  // },

    var formatedCharge="";

    if(devInst.charge.length<8){
      for(var r=0;r<(8-devInst.charge.length);r++){
        formatedCharge += '0';
      }
    }

    formatedCharge += devInst.charge;

    var res = formatedCharge + ' P' + prog.Index + ' ' + prog.content + '(' + getProgState(Number(devInst.progState)) + ')';

    if(Number(devInst.progState)==_MST_Running){
      estim = new Date(prog.Estim*1000);
      res += '  Phase: ' + prog.PhaseID + ' ' + prog.Phase + ', Estim time: ' + estim.getUTCHours()+':' + estim.getUTCMinutes()+':'+estim.getUTCSeconds();
    }

    return prog;
  }

  function parseMessages(msgs) {
    var m = JSON.parse(msgs).Messages;

    var res="";

    // decode messages
    for (var i = 0; i < Object.values(m).length; i++) {
      var c;

      c = m['m' + i];

      var args=[];
      var q = -1;

      do {
        q++;
        var item;
        if (q > 0)
          item = c['a' + q];
        else
          item = c['a'];

        if(item!=undefined){
          args[q] = item;
        }

      } while (item);

      var msg = c['msg']['content'];

      // parse message
      for (var t = 0; t < Object.values(args).length; t++) {
          msg = msg.replace("%"+(t+1), args[t]);
      }

      var mtype;
      if (c['msg']['type'] == "2") {
        mtype = '(error) ';
      } else {
        mtype = '(info) ';
      }

      var date = new Date(c['msg']['time']*1000); // set your time format string
      res += mtype + date.toISOString() + ': ' + msg + c['msg']['L'] + '\n';
      delete date;
    }

    return m;
  }

  // "events": {
  //   "e": {
  //       "color": "#000000",
  //       "content": "",
  //       "font-size": "28",
  //       "pkgID": "03",
  //       "type": "space"
  //   },
  //   "e1": {
  //       "color": "#000000",
  //       "content": "Unisteri HP IL 336 2ED 5170661",
  //       "font-size": "64",
  //       "pkgID": "42",
  //       "type": "text"
  //   },


  function parseProtocol(prtData) {
    if (prtData.length < 10) return "";
    console.log(prtData, 'the prt data')
    var dev = JSON.parse(prtData).Dev;
    var errors = JSON.parse(prtData).Errors;
    var program = JSON.parse(prtData).Program;
    var events = JSON.parse(prtData).events;
    var phases = JSON.parse(prtData).Phases;
    var senzorData = JSON.parse(prtData).data;

    // analog configuration
    var IOMap = JSON.parse(prtData).IOMap;

    var res="";
    
    // res += dev["Name"] + '\n';
    // res += program["Name"]["content"] + '\n'; // program name
    // res += program["Result"] + '\n'; // program result

    var k = Object.keys(events);

    // list protocol events
    for (var t = 0; t < k.length; t++) {
      var event;

      if (t == 0)
          event = events["e"];
      else
          event = events["e" + t];

      if (event['type'] == "text") {
        var value = event["value"];
        if(!value) value="";

        var time = event["time"];
        if(time) {
           time = new Date(time*1000).toISOString();  // set your time format string
        }else{
          time = "";
        }

        if(time!=""){
            res += time + "  " + event["content"] + "  " + value + '\n';
        }else{
            res += event["content"] + "  " + value + '\n';
        }
      }else if(event['type']=='space'){
        res += '\n';
      }
    }

    // list protocol analogs
    let v = [];
    if(senzorData) {
      v = Object.values(senzorData);
  
      console.log("protocol charge(" + program["Charge"] + "): ");// + res + '\nAnalog Samples: '+ v.length);
    }

    return {
      dev,
      errors,
      program,
      events,
      phases,
      senzorData,
    };
  }

//   case _eventExtSysFSState:
//     sendCmdConfirm(appCmdDevEvent, QString::number(event.ID), QStringList()<<QString::number(event.FSReadyState.state)<<QString::number(conID));
//     break;
// case _eventExtSysPrtCharge:
//     sendCmdConfirm(appCmdDevEvent, QString::number(event.ID), QStringList()<<QString::number(event.prtCharge.charge)<<QString::number(event.prtCharge.ut)<<QString::number(conID));
//     break;

  function decodeExtEvent(id, args) {
    var res;
    switch (Number(id)) {
      case _eventExtSysFSState:
        
        var state = args[0];
        var conID = args[1];
        res = "_eventExtSysFSState event " + state + "from conID: " + conID;
        console.log(res);
        break;
        case _eventExtSysPrtCharge:
           // new charge completed
           // download protocol...

           var charge = args[0];           
           var date = new Date(args[1]*1000);
           if(!date){
               date="";
           }else{
             if(date!=0)
               date = date.toTimeString();
             else
               date = "";
           }
           var conID = args[2];
           res = "new charge: " + charge + " completed at: " + date + "from conID: " + conID;
           delete date;
           console.log(res);
        break;
    }
    return res;
  }

  // api functions to comunicate with BMTCommServer
  function cmdOpenConn(devIP) {
    if (sendCMD(appCmdDevConnect, devIP, [_devUnisteri2021])) {
      console.log("connecting to: " + devIP);
    }
  }

  function cmdCloseConn(conID) {
    if (sendCMD(appCmdDevDisconnect, conID, [])) {
      console.log("connection closed: " + devInst.conID + ", ip: " + devInst.ip);
    }
  }

  function cmdReadStatus(conID) {
    if (sendCMD(appCmdDevState, conID, ["1"])) {    // args: "1" - use json format
      console.log("cmdReadStatus sended: " + devInst.ip);
    }
  }

  function cmdReadProtocol(conID, charge) {
    // args:
    // charge - read charge number, "0" - utf time required only for old SterivapHP so there is 0, "" - dev serial number(required only for old SterivapHP), "1" - use json format
    if (sendCMD(appCmdDevReadProtocolFormated, conID, [ JSON.stringify(charge), "0", "0", "1"])) {
      console.log("cmdReadProtocol sended: " + devInst.ip + " conID:" + conID + " Charge: " + charge);
    }
  }

}); // end client.on

const readAndDeploy = () => {
  devInst.statusData = JSON.parse(message.utf8Data).data;
  let devStateData;
  let protocolData;
  if (devInst.statusData.length != 0) {
    devStateData = parseDevState(devInst.statusData);

    // sendWebResponse(appCmdDevState, data, [""], devInst.conID);
  }
  if(devStateData) {
    devInst.prtContent = JSON.parse(message.utf8Data).data;
    protocolData = parseProtocol(devInst.prtContent);
  }
  console.log(devStateData,protocolData, "protocolData")
}
// make client ws connection with BMTCommServer
// client.connect('ws://localhost:9021/');

var counter = 0;

const server = http.createServer((_req, res) => {
  
// proxy settings
//   _req.addListener("end", function() {
//     var options = {
//       hostname: '192.168.59.7',
//       port: 3128,
//       path: _req.url,
//       method: _req.method,
//       headers: _req.headers
//       // agent: http.Agent({keepAlive:true}),
//     };

//     var req=http.request(options, function(qres) {
//         var body;
//         qres.on('data', function (chunk) {
//             body += chunk;
//         });
//         qres.on('end', function () {
//              res.writeHead(qres.statusCode, qres.headers);
//              res.end(body);
//         });
//     });

// });
// proxy settings end

  counter += 1;

  function readFileContent(file) {
    try {
      const data = httpfs.readFileSync(file, 'utf8')
      // console.log(data)
      return data;
    } catch (err) {
      console.error(err)
    }
  }

  function fileExist(file) {

    try {
      if (httpfs.existsSync(file)) {
        //file exists
        return true;
      }
    } catch (err) {
      console.error(err)
      return false;
    }

    return false;
  }

  function parseHtmlRequest(request, cmd, arg, argList) {
    var i = 0;
    i = request.indexOf("cmd");
    if (i != -1) {

    }
  }

  ///////////////////////
  let reqbody = '';

  // handle web files
  if (_req.method === 'GET') {
    var webfile;
    var request = _req.url;

    let rdata = '';
    _req.on('data', chunk => {
      rdata += chunk;
    }).on('end', () => {

    }).on('error', (e) => {
        console.error('_req error ' + e);
    });

    if (_req.url == "/") {
      webfile = "./web/index.html";
    } else {
      webfile = "./web" + _req.url;
    }

    if (fileExist(webfile)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      data = readFileContent(webfile);
      res.write(data);
    } else {

    }
    res.end();
  }
  else if (_req.method === 'POST') {
    // handle action requests for BMTCommServer

    _req.on('data', (data) => {
      reqbody += data;
    });
    _req.on('end', () => {

      // with json req
      var r = JSON.parse(reqbody);
      var cmd = r.cmd;
      var data = r.data;
      var conID = r.conID;
      var args = r.args;

      devInst.webRes = res;

      switch (cmd) {
        // connect to BMTCommServer
        case appCmdConnectToBMTServer:
          client.connect('ws://localhost:9021/');
          break;

        // dissconnect from BMTCommServer
        case appReadAndDeploy:
          if (devInst.BMTCommSrvConnection) {
            if (devInst.BMTCommSrvConnection.connected) {
              devInst.BMTCommSrvConnection.close(devInst.BMTCommSrvConnection.CLOSE_REASON_NORMAL, "user close");
              readAndDeploy(devInst.conID);
              // send response
              sendWebResponse(cmd, "dissconnected.", "", devInst.conID);
            }else{
              sendWebResponse(cmd, "not connected.", "", devInst.conID);
            }
          }else{
            sendWebResponse(cmd, "not connected.", "", devInst.conID);
          }
        break;
        case appCmdDisconnectFromBMTServer:
          if (devInst.BMTCommSrvConnection) {
            if (devInst.BMTCommSrvConnection.connected) {
              devInst.BMTCommSrvConnection.close(devInst.BMTCommSrvConnection.CLOSE_REASON_NORMAL, "user close");
              // send response
              sendWebResponse(cmd, "dissconnected.", "", devInst.conID);
            }else{
              sendWebResponse(cmd, "not connected.", "", devInst.conID);
            }
          }else{
            sendWebResponse(cmd, "not connected.", "", devInst.conID);
          }
          
          break;

        default:

          if (!data) { data = ""; }
          if (!args) { args = []; }
          if (!conID) { conID = devInst.conID; }

          // all commands from web is redirected to BMTCommServer here
          sendCMD(cmd, data, args);
          break;
      }

    });
  }
  else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<h1>404 ERROR could not find that Page</h1>`);
  }


}).on("error", (err) => {
  console.log("Error: " + err.message);
});

// web server
// server.host = '192.168.51.98';
server.listen(2000);
console.log('nodejs server started.');

