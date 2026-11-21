import { lesson, configure, config, exec, shell, tcl, toggle, observe, read, all, assign } from './lesson.mjs';
const c=configure;

export const automation = [
  lesson({
    id:'netconf-restconf',title:'NETCONF, RESTCONF and YANG validation',topics:{encor:['4.6','5.3','6.2','6.3','6.5'],enarsi:['4.1.b']},portable:[],guide:[28],
    topology:['PC1 · Test API client','R1 · IOS XE management API fixtures'],
    task:'Enable model-driven management, inspect both interfaces, and distinguish authentication, malformed input and successful JSON updates.'
  }, [
    config('R1',[
      ['ip ssh version 2','NETCONF commonly uses the SSH subsystem.'],
      toggle('netconf-yang','Enable the simulated NETCONF service.','netconf'),
      ['ip http secure-server','Provide HTTPS transport for RESTCONF.'],
      ['ip http authentication local','Use the lab’s existing local authentication.'],
      toggle('restconf','Enable the RESTCONF interface over HTTPS.','restconf')
    ]),
    exec('R1',[
      observe('show netconf-yang sessions','Read the NETCONF session list.',all('netconf','netconfSession'),
        'Session ID: 101  Transport: netconf-ssh  User: LABAPI','No active NETCONF session.'),
      observe('show platform software yang-management process','Check whether the model-driven management processes are initialized.',all('netconf','restconf'),
        'ncsshd: Running\nndbmand: Running\nnginx: Running\nconfd: Running','Management services are incomplete.')
    ]),
    shell('PC1',[
      ['ssh -s -p 830 LABAPI@192.0.2.220 netconf','Open the simulated SSH subsystem and read server capabilities.',
        s=>{s.netconfSession=Boolean(s.netconf);},s=>s.netconfSession?'<hello><capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities><session-id>101</session-id></hello>':'NETCONF subsystem unavailable.'],
      observe('<rpc message-id="72" xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><get-config><source><running/></source></get-config></rpc>',
        'Retrieve simulated running configuration with an XML RPC.',all('netconf','netconfSession'),
        '<rpc-reply message-id="72"><data><interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/></data></rpc-reply>',
        '<rpc-error><error-tag>operation-failed</error-tag></rpc-error>'),
      observe('curl -i --cacert netra-ca.pem https://192.0.2.220/restconf/data/ietf-interfaces:interfaces','Observe an unauthenticated request.',all('restconf'),
        'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Basic realm="Netra lab"','Connection refused.'),
      observe("curl -i --cacert netra-ca.pem -u LABAPI:NetraApiLab -H 'Accept: application/yang-data+json' https://192.0.2.220/restconf/data/ietf-interfaces:interfaces",
        'Request YANG-modeled data as JSON over HTTPS.',all('restconf'),
        s=>'HTTP/1.1 200 OK\n'+JSON.stringify({'ietf-interfaces:interfaces':{interface:[{name:'GigabitEthernet0/0',enabled:true,description:s.description??'WAN uplink'}]}},null,2),'Connection refused.'),
      ["curl -i --cacert netra-ca.pem -u LABAPI:NetraApiLab -X PATCH -H 'Content-Type: application/yang-data+json' -d '{\"ietf-interfaces:interface\":{\"description\":\"Netra edge\"}}' https://192.0.2.220/restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F0",
        'Make an isolated update using a model-qualified payload and a percent-encoded list key.',
        s=>{if(s.restconf)s.description='Netra edge';},s=>s.restconf?'HTTP/1.1 204 No Content':'Connection refused.'],
      observe("curl -i --cacert netra-ca.pem -u LABAPI:NetraApiLab -H 'Accept: application/yang-data+json' https://192.0.2.220/restconf/data/ietf-interfaces:interfaces",
        'Confirm the updated description and exact JSON types.',all('restconf'),
        s=>'HTTP/1.1 200 OK\n'+JSON.stringify({'ietf-interfaces:interfaces':{interface:[{name:'GigabitEthernet0/0',enabled:true,description:s.description??'WAN uplink'}]}},null,2),'Connection refused.'),
      observe("curl -i --cacert netra-ca.pem -u LABAPI:NetraApiLab -X PATCH -H 'Content-Type: application/yang-data+json' -d '{\"ietf-interfaces:interface\":{\"enabled\":\"true\"}}' https://192.0.2.220/restconf/data/ietf-interfaces:interfaces/interface=GigabitEthernet0%2F0",
        'Compare a JSON string with the boolean required by the YANG leaf.',all('restconf'),
        'HTTP/1.1 400 Bad Request\n{"ietf-restconf:errors":{"error":[{"error-tag":"invalid-value","error-message":"Expected boolean for enabled"}]}}','Connection refused.')
    ]),
    exec('R1',[
      observe('show netconf-yang sessions','Confirm that the successful SSH subsystem created a session.',all('netconf','netconfSession'),
        'Session ID: 101  Transport: netconf-ssh  User: LABAPI','No active NETCONF session.')
    ])
  ]),

  lesson({
    id:'apis-assurance',title:'Catalyst Center Assurance and SD-WAN APIs',topics:{encor:['1.2.a','1.3.a','4.5','5.3','6.4','6.5'],enarsi:['4.7']},portable:[],guide:[22,23,28],
    topology:['PC1 · API console','R1 · Branch device inventory fixture'],
    task:'Use a simulated controller API to inspect inventory and health, correlate an interface incident, and compare Catalyst Center token use with SD-WAN Manager session state.'
  }, [
    shell('PC1',[
      ["curl -i --cacert netra-ca.pem -u LABAPI:NetraApiLab -X POST https://center.example/dna/system/api/v1/auth/token",
        'Request a session token from the mock Catalyst Center API.',assign({centerToken:true}),()=> 'HTTP/1.1 200 OK\n{"Token":"NETRA-CENTER-DEMO"}'],
      observe("curl -i --cacert netra-ca.pem -H 'X-Auth-Token: NETRA-CENTER-DEMO' https://center.example/dna/intent/api/v1/network-device",
        'Check read-only inventory fields and map the device to its management IP.','centerToken',
        'HTTP/1.1 200 OK\n{"response":[{"hostname":"R1","managementIpAddress":"192.0.2.223","reachabilityStatus":"Reachable"}]}','HTTP/1.1 401 Unauthorized'),
      observe("curl -i --cacert netra-ca.pem -H 'X-Auth-Token: NETRA-CENTER-DEMO' https://center.example/dna/intent/api/v1/network-health",
        'Interpret network-level health separately from individual device reachability.','centerToken',
        'HTTP/1.1 200 OK\n{"response":[{"healthScore":74,"totalCount":2,"healthyCount":1}]}','HTTP/1.1 401 Unauthorized'),
      observe("curl -i --cacert netra-ca.pem -H 'X-Auth-Token: NETRA-CENTER-DEMO' 'https://center.example/dna/intent/api/v1/issues?priority=P2'",
        'Check the mock issue feed to isolate the degraded device and interface.','centerToken',
        'HTTP/1.1 200 OK\n{"response":[{"name":"High interface errors","priority":"P2","device":"R1","interface":"GigabitEthernet0/0"}]}','HTTP/1.1 401 Unauthorized'),
      ["curl -i --cacert netra-ca.pem -c netra-cookie.txt -d 'j_username=LABAPI&j_password=NetraApiLab' https://manager.example/j_security_check",
        'Request the mock SD-WAN Manager session cookie.',assign({manager:true}),()=> 'HTTP/1.1 200 OK\nSet-Cookie: JSESSIONID=NETRA-SDWAN'],
      observe('curl -i --cacert netra-ca.pem -b netra-cookie.txt https://manager.example/dataservice/client/token',
        'Request the lab anti-CSRF token for operations that need it.','manager','HTTP/1.1 200 OK\nNETRA-SDWAN-CSRF','HTTP/1.1 401 Unauthorized'),
      observe('curl -i --cacert netra-ca.pem -b netra-cookie.txt https://manager.example/dataservice/device',
        'Compare SD-WAN control and device inventory data with Catalyst Center’s response schema.','manager',
        'HTTP/1.1 200 OK\n{"data":[{"host-name":"R1","system-ip":"10.72.252.1","reachability":"reachable"}]}','HTTP/1.1 401 Unauthorized')
    ]),
    exec('R1',[
      read('show interfaces GigabitEthernet0/0','Validate the reported health issue at the device.','GigabitEthernet0/0 is up, line protocol is up\n194 input errors, 194 CRC, 0 frame'),
      read('show sdwan control connections','Inspect the simulated controller connection state.','PEER TYPE  SYSTEM IP    PROTOCOL  STATE\nvsmart     10.72.252.2  dtls      up\nvmanage    10.72.252.3  tls       up'),
      read('show sdwan omp peers','Verify the overlay control-plane peer comes up independently of inventory polling.','PEER        STATE  R/I/S\n10.72.252.2 up     24/20/6')
    ])
  ]),

  lesson({
    id:'eem-tcl-tools',title:'EEM, Tcl and Python operations',topics:{encor:['6.1','6.2','6.6','6.7'],enarsi:['4.3','4.7']},portable:[11],guide:[28,29],
    topology:['R1 · EEM and Tcl console','PC1 · Script and JSON practice shell'],
    task:'Attach a safe diagnostic applet to a simulated syslog event, then interpret Python and JSON results. All shell and IOS examples run against local fixtures.'
  }, [
    c('R1',['event manager applet WAN-DIAG'],[
      toggle('event syslog pattern "Interface GigabitEthernet0/2, changed state to down"','Match an exact lab link event.','event'),
      ['action 1.0 cli command "enable"','Enter privilege in the applet’s internal CLI session.'],
      toggle('action 2.0 cli command "show interfaces GigabitEthernet0/2"','Collect link status without changing the device.','gather'),
      ['action 3.0 syslog msg "WAN-DIAG collected interface state"','Record the diagnostic result in the lab log.']
    ]),
    c('R1',['event manager applet MANUAL-REPORT'],[
      toggle('event none','Allow manual execution for verification.','manual'),
      ['action 1.0 syslog msg "Manual lab event"','Write a benign syslog message.']
    ]),
    exec('R1',[
      observe('show event manager policy registered','Check that the requested applets are registered.',all('event','manual'),
        'WAN-DIAG       applet syslog\nMANUAL-REPORT  applet none','The expected applets are not all registered.'),
      ['event manager run MANUAL-REPORT','Run the applet that uses event none.',s=>{s.manualRun=s.manual;},s=>s.manualRun?'MANUAL-REPORT completed.':'Register the event-none applet first.']
    ]),
    c('R1',['interface GigabitEthernet0/2'],[
      ['shutdown','Generate a link-down trigger in the simulator.',s=>{s.eventRun=all('event','gather')(s);}]
    ]),
    exec('R1',[
      observe('show event manager history events','Check the recorded event and collected action results.',all('eventRun'),
        s=>(s.manualRun?'1  MANUAL-REPORT  none    completed\n':'')+'2  WAN-DIAG       syslog  completed','No completed WAN-DIAG run.')
    ]),
    tcl('R1',[
      read('puts [expr {6 * 12}]','Confirm the Tcl interpreter evaluates this example expression.','72'),
      read('foreach addr {192.0.2.210 192.0.2.214} {ping $addr repeat 2}','Practice executing a fixed set of verification commands from the lab interpreter.','192.0.2.210  !!  2/2\n192.0.2.214  !!  2/2')
    ]),
    c('R1',['interface GigabitEthernet0/2'],[
      ['no shutdown','Restore the protected mock interface after the diagnostic.']
    ]),
    shell('PC1',[
      read("python3 -c 'ports=[(\"Gi0/0\", True), (\"Gi0/2\", False)]; print([name for name, up in ports if up])'",
        'Trace the condition and unpacking in the list comprehension.',"['Gi0/0']"),
      read("python3 -c 'import json; print(json.dumps({\"enabled\": True, \"site\": \"branch\"}))'",
        'See the Python boolean serialized as the JSON boolean.', '{"enabled": true, "site": "branch"}'),
      read("printf '%s\\n' '{\"hostname\":\"R1\",\"enabled\":true,\"port\":72}' | python3 -m json.tool",
        'Validate a syntactically correct JSON object and compare its value types.',
        '{\n    "hostname": "R1",\n    "enabled": true,\n    "port": 72\n}'),
      read("printf '%s\\n' '{hostname:\"R1\",\"enabled\":true}' | python3 -m json.tool",
        'Diagnose why an unquoted object key fails validation.', 'Expecting property name enclosed in double quotes: line 1 column 2 (char 1)'),
      read('ansible-playbook -i lab-inventory verify-interfaces.yml --check','Read a simulated dry run from an agentless workflow.',
        'PLAY RECAP\nR1 : ok=2 changed=0 unreachable=0 failed=0')
    ])
  ])
];
