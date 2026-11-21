import { lesson, configure, config, exec, shell, rommon, toggle, observe, read, all, assign } from './lesson.mjs';
const c=configure;

export const security = [
  lesson({
    id:'ssh-vty-aaa',title:'SSH, VTY access and local AAA fallback',topics:{encor:['5.1.a','5.1.b'],enarsi:['3.1','4.1.a','4.1.b']},portable:[9,10],guide:[26],
    topology:['PC1 · Management client','R1 · Device access CLI','R2 · Simulated AAA responses'],
    task:'Use a local account, a remote AAA server group, and a named VTY method list. Distinguish a transport timeout from an explicit AAA rejection.'
  }, [
    exec('R1',[observe('show ip ssh','Start by checking whether the management listener is available.',all('keys','ssh'),
      'SSH Enabled - version 2.0\nAuthentication timeout: 30 secs; retries: 2','SSH Disabled. Configure hostname/domain and an RSA key pair.')]),
    config('R1',[
      ['hostname R1','Set the device hostname used with the SSH domain.'],
      ['ip domain name campus.example','Provide the DNS domain required for this key example.'],
      ['service password-encryption','Practice the obfuscation setting for supported cleartext configuration fields.'],
      ['enable algorithm-type scrypt secret NetraEnablePractice','Use a salted scrypt secret where supported.'],
      toggle('username LABADMIN privilege 15 algorithm-type scrypt secret NetraAdminPractice','Create a lab-only privileged user.','localUser'),
      toggle('crypto key generate rsa modulus 2048','Configure the device’s simulated RSA host key.','keys'),
      toggle('ip ssh version 2','Require SSH protocol version 2.','ssh'),
      ['ip ssh time-out 30','Set a reasonable handshake timeout for the lab.'],
      ['ip ssh authentication-retries 2','Limit authentication retries on the SSH transport.'],
      ['banner motd ^Authorized lab access only^','Set a notice on login.']
    ]),
    c('R1',['line console 0'],[
      ['login local','Practice the local database on console before applying a named method.'],
      ['logging synchronous','Avoid overwriting an in-progress console line.'],
      ['exec-timeout 10 0','Set an idle console-session timeout.']
    ]),
    c('R1',['ip access-list standard MGMT-SOURCES'],[
      ['10 permit 192.0.2.160 0.0.0.15','Permit the management segment.'],
      ['20 deny any log','Keep the final deny visible for audit.']
    ]),
    config('R1',[
      ['aaa new-model','Enable IOS AAA processing in the scenario.'],
      ['aaa authentication login CONSOLE local','Use the local database for console recovery.'],
      toggle('aaa authentication login VTY-AUTH group LAB-TAC local','Try the named TACACS+ group, using local on service error.','method'),
      ['aaa authorization exec VTY-EXEC group LAB-TAC local','Apply the authorization list for opening an EXEC shell.'],
      ['aaa authorization commands 15 VTY-CMD group LAB-TAC local','Apply command authorization for privilege level 15.'],
      ['aaa accounting exec VTY-ACCT start-stop group LAB-TAC','Record successful session start and stop.']
    ]),
    c('R1',['tacacs server LAB-AUTH'],[
      ['address ipv4 192.0.2.162','Configure the lab TACACS+ target.'],
      toggle('key NetraTacacsLab72','Set the router-side shared lab key.','tacacsKey'),
      ['timeout 3','Set the server timeout before the group method tries fallback.']
    ]),
    c('R1',['aaa group server tacacs+ LAB-TAC'],[
      ['server name LAB-AUTH','Associate the server definition with the named method group.'],
      ['ip tacacs source-interface GigabitEthernet0/0','Set the AAA source interface expected by the service.']
    ]),
    c('R1',['line console 0'],[
      ['login authentication CONSOLE','Bind the local recovery method to the console.']
    ]),
    c('R1',['line vty 0 4'],[
      toggle('transport input ssh','Permit SSH as the VTY inbound transport.','vty'),
      ['login authentication VTY-AUTH','Bind the named authentication method list.'],
      ['authorization exec VTY-EXEC','Bind authorization for the interactive shell.'],
      ['authorization commands 15 VTY-CMD','Bind command authorization for the VTY.'],
      ['accounting exec VTY-ACCT','Bind EXEC session accounting.'],
      toggle('access-class MGMT-SOURCES in','Limit who may open a VTY from the management segment.','acl')
    ]),
    exec('R1',[
      observe('show ip ssh','Confirm the key and protocol-version prerequisites are satisfied.',all('keys','ssh'),
        'SSH Enabled - version 2.0\nAuthentication timeout: 30 secs; retries: 2','SSH Disabled. Configure hostname/domain and an RSA key pair.'),
      read('show login','Inspect management login policy.','Console uses CONSOLE · VTY 0–4 use VTY-AUTH'),
      observe('show aaa servers','Distinguish a lab AAA timeout from an access reject.','tacacsKey',
        'TACACS+ 192.0.2.162:49  Service state: TIMEOUT (scenario fault)\nSelected fallback: local on error','No TACACS+ server defined.'),
      read('show access-lists MGMT-SOURCES','Review the ACL applied to incoming VTY access.','Standard IP access list MGMT-SOURCES\n 10 permit 192.0.2.160, wildcard bits 0.0.0.15\n 20 deny any log')
    ]),
    shell('PC1',[
      observe('ssh -l LABADMIN 192.0.2.161','Open a simulated SSH session after the upstream AAA method times out.',all('keys','ssh','localUser','method','vty','acl'),
        'TACACS+ did not respond. Local lab authentication accepted.\nR1#','Connection did not reach an authenticated EXEC prompt.')
    ]),
    exec('R1',[
      observe('show users','Review the resulting type of line and account selection.',all('keys','ssh','localUser','method','vty','acl'),
        'Line     User       Host(s)       Location\nvty 0    LABADMIN   idle          192.0.2.166','No VTY session.'),
      read('show ssh','Read the simulated SSH version and session status.','Connection  Version  Mode  Encryption  State\n0           2.0      IN    aes256-ctr  Session started')
    ])
  ]),

  lesson({
    id:'radius-dot1x',title:'RADIUS, 802.1X and MAB troubleshooting',topics:{encor:['5.1.b','5.4.b','5.4.d'],enarsi:['3.1']},portable:[10],guide:[25,26],
    topology:['PC1 · Supplicant','SW1 · Authenticator','R1 · Simulated RADIUS decisions'],
    task:'Configure RADIUS and an access port. Interpret an authorization state change when the configured lab supplicant receives an Access-Accept.'
  }, [
    config('SW1',[
      ['aaa new-model','Turn on IOS AAA for the authenticator.'],
      ['aaa authentication dot1x default group CAMPUS-RADIUS','Associate identity requests with the RADIUS server group.'],
      ['aaa authorization network default group CAMPUS-RADIUS','Use network authorization for the endpoint policy.'],
      ['aaa accounting dot1x default start-stop group CAMPUS-RADIUS','Keep the session accounting record.'],
      toggle('dot1x system-auth-control','Enable 802.1X on the switch.','dot1x'),
      ['ip radius source-interface Vlan72','Choose the address registered with the RADIUS service.']
    ]),
    c('SW1',['radius server CAMPUS-LAB'],[
      ['address ipv4 192.0.2.172 auth-port 1812 acct-port 1813','Configure the standard authentication and accounting ports.'],
      toggle('key NetraRadiusLab72','Set the local key for the simulated service.','radiusKey')
    ]),
    c('SW1',['aaa group server radius CAMPUS-RADIUS'],[
      ['server name CAMPUS-LAB','Select the named service for this AAA method group.']
    ]),
    c('SW1',['interface GigabitEthernet0/3'],[
      ['switchport mode access','Set the access port mode.'],
      ['switchport access vlan 72','Use the campus data VLAN in the base lab.'],
      toggle('authentication port-control auto','Require the configured method for access.','port'),
      ['authentication order dot1x mab','Try 802.1X before the MAC Authentication Bypass fallback.'],
      ['authentication priority dot1x mab','Prefer stronger 802.1X authentication when both become available.'],
      ['mab','Enable the device-identity fallback for a configured endpoint.'],
      ['dot1x pae authenticator','Set the switch side as the authenticator.']
    ]),
    exec('SW1',[
      observe('show authentication sessions interface GigabitEthernet0/3 details','Inspect method state and VLAN authorizations.',all('dot1x','radiusKey','port','supplicant'),
        'Status: Authorized\nMethod: dot1x\nServer Policy: VLAN 72','Status: Unauthorized\nNo successful supplicant exchange yet.'),
      observe('test aaa group radius LABUSER NetraRadiusClient legacy','Use a lab-only test identity to separate switch/RADIUS reachability from port policy.','radiusKey',
        'User successfully authenticated by the lab AAA response.','No response from the simulated RADIUS service.')
    ]),
    shell('PC1',[
      ['wpa_cli reauthenticate','Initiate the already configured test supplicant’s exchange.',assign({supplicant:true}),()=> 'OK – scenario supplicant restarted.']
    ]),
    exec('SW1',[
      observe('show authentication sessions interface GigabitEthernet0/3 details','Verify the declared identity and resulting authorization.',all('dot1x','radiusKey','port','supplicant'),
        'Status: Authorized\nMethod: dot1x\nServer Policy: VLAN 72','Status: Unauthorized\nNo successful supplicant exchange yet.'),
      read('show dot1x interface GigabitEthernet0/3 details','Check PAE role and operational authentication state.','PAE = AUTHENTICATOR\nPortStatus = AUTHORIZED\nDot1x critical timeout: none'),
      read('show radius statistics','Inspect the sent requests and accepted responses.','Access-Requests 1\nAccess-Accepts 1\nAccess-Rejects 0\nTimeouts 0')
    ])
  ]),

  lesson({
    id:'filtering-urpf',title:'IPv4/IPv6 ACLs, time ranges and uRPF',topics:{encor:['5.2.a'],enarsi:['3.2.a','3.2.b','3.2.c']},portable:[10],guide:[26],
    topology:['PC1 · Managed source','R1 · Edge filtering','R2 · Routed destination'],
    task:'Apply IPv4 and IPv6 input policies, inspect counters, and compare strict uRPF with loose source validation on an asymmetric route.'
  }, [
    c('R1',['time-range BUSINESS-HOURS'],[
      toggle('periodic weekdays 8:00 to 17:00','Use the simulated weekday window for the override.','window')
    ]),
    c('R1',['ip access-list extended EDGE-V4'],[
      ['remark Permit management and controlled test traffic','Label the reason for the entries.'],
      toggle('10 permit tcp 192.0.2.160 0.0.0.15 host 198.51.100.181 eq 443 time-range BUSINESS-HOURS','Allow the test TLS connection only in the simulated office window.','v4Rule'),
      ['20 permit icmp any any echo-reply','Permit selected reply traffic.'],
      ['30 deny ip any any log','Make the explicit final action visible in counters.']
    ]),
    c('R1',['ipv6 access-list EDGE-V6'],[
      ['remark Preserve neighbor discovery on this segment','Record the IPv6 control-plane requirement.'],
      ['sequence 10 permit icmp any any nd-ns','Permit Neighbor Solicitation explicitly.'],
      ['sequence 15 permit icmp any any nd-na','Permit Neighbor Advertisement explicitly.'],
      toggle('sequence 20 permit tcp 2001:db8:1800::/64 host 2001:db8:1801::53 eq 443','Permit the selected IPv6 application flow.','v6Rule'),
      ['sequence 90 deny ipv6 any any log','Add an explicit logged deny after the ND and application rules.']
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      toggle('ip access-group EDGE-V4 in','Apply the IPv4 ACL in the ingress direction.','v4Applied'),
      toggle('ipv6 traffic-filter EDGE-V6 in','Apply the IPv6 traffic filter at ingress.','v6Applied'),
      ['ip verify unicast source reachable-via rx','Check that the best source route points to the receiving interface.',assign({strict:true,loose:false}),null,'source-validation-v4'],
      ['ipv6 verify unicast source reachable-via any','Use the available-route check for the IPv6 example.']
    ]),
    shell('PC1',[
      observe('curl -I https://198.51.100.181','Exercise the allow rule during the simulated window.',all('window','v4Rule','v4Applied'),
        'HTTP/1.1 200 OK\nLab ACL permitted TCP/443.','Timed out · check the time-range and interface ACL.'),
      observe('curl -I https://[2001:db8:1801::53]','Check the independently configured IPv6 policy.',all('v6Rule','v6Applied'),
        'HTTP/1.1 200 OK\nLab IPv6 ACL permitted TCP/443.','Timed out · check the IPv6 traffic filter.')
    ]),
    exec('R1',[
      observe('show ip interface GigabitEthernet0/0','Verify the applied ACL and strict source validation.','strict',
        'Inbound access list is EDGE-V4\nIP verify source reachable-via RX',s=>s.loose?'Inbound access list is EDGE-V4\nIP verify source reachable-via ANY':'uRPF is disabled.'),
      observe('show ip access-lists EDGE-V4','Review ACE order and the active time range.',all('window','v4Rule','v4Applied'),
        '10 permit tcp 192.0.2.160 0.0.0.15 host 198.51.100.181 eq 443 time-range BUSINESS-HOURS (active)\n30 deny ip any any log','ACL policy incomplete.'),
      observe('show ipv6 access-list EDGE-V6','Confirm ND and application ACEs are ordered before the final deny.',all('v6Rule','v6Applied'),
        '10 permit icmp any any nd-ns\n15 permit icmp any any nd-na\n20 permit tcp 2001:DB8:1800::/64 host 2001:DB8:1801::53 eq 443\n90 deny ipv6 any any log','IPv6 filter incomplete.'),
      read('show time-range BUSINESS-HOURS','Read the activation schedule and synthetic current window.','periodic weekdays 08:00 to 17:00 (active in this lab)')
    ]),
    c('R1',['interface GigabitEthernet0/0'],[
      ['ip verify unicast source reachable-via any','Use loose validation where the allowed source route is asymmetric.',assign({strict:false,loose:true}),null,'source-validation-v4']
    ]),
    exec('R1',[
      observe('show ip interface GigabitEthernet0/0','Check the adjusted uRPF mode.','strict',
        'Inbound access list is EDGE-V4\nIP verify source reachable-via RX',s=>s.loose?'Inbound access list is EDGE-V4\nIP verify source reachable-via ANY':'uRPF is disabled.'),
      observe('show ip traffic','Compare validation drops before and after the policy fix.','loose',
        'IP source validation: strict-path drops stopped for reachable asymmetric sources.','IP source validation: strict path verification drops reported.')
    ])
  ]),

  lesson({
    id:'copp-routing-management',title:'Control plane policing and class counters',topics:{encor:['5.2.b','1.4'],enarsi:['3.3']},portable:[10],guide:[14,26],
    topology:['PC1 · Management probe','R1 · CPU-bound traffic','R2 · Routing peer'],
    task:'Classify management and routing traffic separately, attach a policing policy to the control plane and compare counter changes with the data plane.'
  }, [
    c('R1',['ip access-list extended CPU-MGMT'],[
      ['permit tcp 192.0.2.160 0.0.0.15 any eq 22','Match authorized management SSH sessions.'],
      ['permit udp host 192.0.2.162 any eq snmp','Match polling from the intended SNMP address.'],
      ['permit tcp 192.0.2.160 0.0.0.15 any eq 443','Match approved HTTPS management traffic.']
    ]),
    c('R1',['ip access-list extended CPU-ROUTING'],[
      ['permit ospf any any','Identify OSPF control traffic.'],
      ['permit eigrp any any','Identify EIGRP protocol messages.'],
      ['permit tcp host 192.0.2.170 any eq bgp','Identify BGP traffic destined to port 179 on the router.']
    ]),
    c('R1',['class-map match-any CONTROL-MGMT'],[
      ['match access-group name CPU-MGMT','Bind the management classifier.']
    ]),
    c('R1',['class-map match-any CONTROL-ROUTING'],[
      ['match access-group name CPU-ROUTING','Bind the routing classifier.']
    ]),
    c('R1',['policy-map PROTECT-CPU','class CONTROL-MGMT'],[
      ['police 256000 conform-action transmit exceed-action drop','Limit management traffic to the scenario’s configured rate.']
    ]),
    c('R1',['policy-map PROTECT-CPU','class CONTROL-ROUTING'],[
      ['police 512000 conform-action transmit exceed-action drop','Give routing exchanges a separate policer.']
    ]),
    c('R1',['control-plane'],[
      toggle('service-policy input PROTECT-CPU','Apply the policy to inbound CPU-destined traffic.','attached')
    ]),
    exec('R1',[
      observe('show policy-map control-plane','Inspect the attached classes and their current policy counters.','attached',
        s=>'Control Plane\n Service-policy input: PROTECT-CPU\n  CONTROL-MGMT: '+(s.samples??0)+' matched; 0 exceeded\n  CONTROL-ROUTING: 6 matched; 0 exceeded','No input policy on the control plane.')
    ]),
    shell('PC1',[
      ['curl -I https://192.0.2.161','Generate one authorized synthetic HTTPS probe to R1 itself.',
        s=>{if(s.attached)s.samples=(s.samples??0)+1;},()=> 'HTTP/1.1 200 OK']
    ]),
    exec('R1',[
      observe('show policy-map control-plane','A management probe to the router should increment only its selected class.','attached',
        s=>'Control Plane\n Service-policy input: PROTECT-CPU\n  CONTROL-MGMT: '+(s.samples??0)+' matched; 0 exceeded\n  CONTROL-ROUTING: 6 matched; 0 exceeded','No input policy on the control plane.'),
      read('show access-lists CPU-ROUTING','Confirm the protocols are classified before changing the rate.','permit ospf any any\npermit eigrp any any\npermit tcp host 192.0.2.170 any eq bgp')
    ])
  ]),

  lesson({
    id:'ipv6-first-hop-protection',title:'IPv6 first-hop security and adjacent trust',topics:{encor:['5.4.a','5.4.b'],enarsi:['3.4']},portable:[],guide:[25,26],
    topology:['PC1 · Host port','SW1 · IPv6 access','R1 · Trusted router uplink'],
    task:'Distinguish trusted router-facing ports from untrusted host ports and inspect the IPv6 snooping binding table in the scenario.'
  }, [
    c('SW1',['ipv6 nd raguard policy USER-ND'],[
      ['device-role host','Disallow Router Advertisements from this host-facing role.']
    ]),
    c('SW1',['ipv6 nd raguard policy UPLINK-ND'],[
      ['device-role router','Recognize the router-facing link role.']
    ]),
    c('SW1',['ipv6 dhcp guard policy CLIENT-ONLY'],[
      ['device-role client','Classify user ports as DHCPv6 client-facing.']
    ]),
    c('SW1',['ipv6 snooping policy CAMPUS-V6'],[
      ['security-level guard','Practice first-hop inspection policy on this VLAN.']
    ]),
    c('SW1',['interface GigabitEthernet0/3'],[
      toggle('ipv6 nd raguard attach-policy USER-ND','Enforce host-role RA Guard on the user port.','raguard'),
      toggle('ipv6 dhcp guard attach-policy CLIENT-ONLY','Apply DHCPv6 guard to the untrusted port.','dhcpguard')
    ]),
    c('SW1',['interface GigabitEthernet0/1'],[
      ['ipv6 nd raguard attach-policy UPLINK-ND','Allow intended router messages on the uplink.']
    ]),
    c('SW1',['vlan configuration 72'],[
      toggle('ipv6 snooping attach-policy CAMPUS-V6','Attach the inspection policy to the VLAN.','snoop')
    ]),
    exec('SW1',[
      observe('show ipv6 nd raguard policy','Verify host/router roles and attachments.','raguard',
        'USER-ND: role host, Gi0/3\nUPLINK-ND: role router, Gi0/1','No host RA Guard policy attached.'),
      observe('show ipv6 dhcp guard policy','Verify the client-facing DHCPv6 guard.','dhcpguard','CLIENT-ONLY: role client, Gi0/3','No client guard policy attached.'),
      observe('show ipv6 snooping binding','Read the VLAN, neighbor address and learned port.','snoop',
        '2001:DB8:7200::21  Gi0/3  VLAN 72  REACHABLE','No IPv6 snooping bindings.')
    ])
  ]),

  lesson({
    id:'device-files-scp',title:'Device management, backups and boot verification',topics:{encor:['5.1.a','4.1'],enarsi:['4.1.a','4.1.b','4.1.c']},portable:[9],guide:[24,26],
    topology:['R1 · IOS XE management','PC1 · Simulated file endpoint','R2 · ROM monitor sample'],
    task:'Check local storage, lock down unused services, and practice backup, boot selection and recovery with simulated files. No network connection or device reboot occurs.'
  }, [
    config('R1',[
      ['ip ssh version 2','Require version 2 for the existing lab SSH management setup.'],
      toggle('ip scp server enable','Enable SCP as the lab’s authenticated file transfer mechanism.','scp'),
      ['ip http secure-server','Enable HTTPS for the intended management client.'],
      ['no ip http server','Disable the cleartext HTTP listener.'],
      ['ip http authentication local','Use the local user database for HTTP authentication.'],
      ['no service tcp-small-servers','Disable legacy diagnostic TCP services.'],
      ['no service udp-small-servers','Disable legacy diagnostic UDP services.'],
      ['ip tftp source-interface GigabitEthernet0/0','Set the source for the TFTP compatibility exercise.'],
      ['ip ftp username LABTRANSFER','Set a mock file-transfer username in the scenario.'],
      ['ip ftp password NetraTransferLab','Supply a mock file-transfer password.'],
      toggle('boot system flash bootflash:packages.conf','Set the installed package manifest as a boot target.','boot'),
      ['config-register 0x2102','Use the typical normal IOS boot setting in the platform example.']
    ]),
    c('R1',['line vty 0 4'],[
      ['transport input ssh','Accept SSH for VTY management.'],
      ['exec-timeout 10 0','Close idle VTY sessions after ten minutes.']
    ]),
    exec('R1',[
      read('show file systems','Locate the boot and persistent configuration filesystems.','bootflash:   rw  disk\nnvram:       rw  nvram\ntftp:        rw  network\nscp:         rw  network'),
      read('dir bootflash:','Identify the installed manifest and local binary.','Directory of bootflash:/\n  packages.conf\n  edge-universalk9-lab.bin\n  device-backup.cfg'),
      read('dir nvram:','Check the startup configuration file before changing anything.','Directory of nvram:/\n  startup-config'),
      read('verify /md5 bootflash:edge-universalk9-lab.bin','Verify the lab binary’s simulated checksum and compare to its expected hash.','Verified MD5 (simulated) = 490e815e2b2b9eac35e102bfb272d43b'),
      observe('show bootvar','Verify both the configured boot path and register information.','boot','BOOT variable = bootflash:packages.conf;\nConfiguration register is 0x2102','BOOT variable not set.'),
      read('show version','Find the running boot target and register value.','System image file is "bootflash:packages.conf"\nConfiguration register is 0x2102'),
      ['copy running-config tftp://192.0.2.182/R1-lab.cfg','Back up the configuration to the mock TFTP endpoint.',assign({tftp:true}),()=> 'Configuration copied (lab fixture).'],
      observe('copy tftp://192.0.2.182/R1-lab.cfg running-config','Practice restoring a saved lab configuration by merge.','tftp','Lab configuration merged.','The mock backup file does not exist.'),
      observe('copy startup-config scp://LABTRANSFER@192.0.2.182/R1-start.cfg','Test the authenticated backup path.','scp','Destination received the lab copy.','SCP server unavailable in the scenario.'),
      ['copy running-config startup-config','Save the lab device configuration.'],
      ['show startup-config','Inspect the scenario’s saved configuration.']
    ]),
    rommon('R2',[
      ['IP_ADDRESS=192.0.2.183','Set the ROM monitor client address in the isolated example.'],
      ['IP_SUBNET_MASK=255.255.255.0','Set the subnet mask used in ROM monitor.'],
      ['DEFAULT_GATEWAY=192.0.2.1','Select the simulated gateway.'],
      ['TFTP_SERVER=192.0.2.182','Select the mock TFTP host.'],
      toggle('TFTP_FILE=edge-universalk9-lab.bin','Select the lab image filename.','romFile'),
      read('set','Review the ROM monitor environment before attempting a recovery.','IP_ADDRESS=192.0.2.183\nTFTP_SERVER=192.0.2.182\nTFTP_FILE=edge-universalk9-lab.bin'),
      observe('tftpdnld -r','Practice a RAM-only recovery boot in the simulated ROM monitor.','romFile','Simulated image loaded to RAM. Persistent storage was not modified.','Set TFTP_FILE and the lab network values first.')
    ])
  ])
];
