export function securityProfileTestMessage(code:string,freshness:string,httpStatus?:number){
 const status=httpStatus?` (HTTP ${httpStatus})`:"";
 if(code==="runtime_capability_missing")return `ADT Runtime does not support Adrian Security Profile testing.${freshness==="superseded"?" Runtime update required.":""}`;
 if(code==="runtime_unreachable")return "ADT Runtime is unavailable.";
 if(code==="runtime_authentication_failed")return "ADT Runtime authentication failed.";
 if(code==="runtime_protocol_incompatible")return "ADT Runtime protocol is incompatible.";
 if(code==="runtime_configuration_invalid")return "ADT Runtime wrapping key configuration is invalid.";
 if(code==="runtime_wrapping_key_mismatch")return "ADT Runtime credential wrapping key does not match.";
 if(code==="adrian_ws_authentication_failed")return `Adrian authentication failed. The configured API key was rejected.${status}`;
 if(code==="adrian_ws_access_forbidden")return `Adrian WebSocket access was forbidden.${status}`;
 if(code==="adrian_ws_upgrade_rejected")return `Adrian rejected the WebSocket endpoint.${status}`;
 if(code==="adrian_ws_unreachable")return "ADT Runtime could not establish a secure WebSocket connection to Adrian.";
 if(code==="adrian_ws_closed_before_login")return "Adrian WebSocket opened, but closed before policy login completed.";
 if(code==="adrian_login_timeout")return "Adrian WebSocket connected, but policy login did not complete.";
 if(code==="adrian_protocol_invalid")return "Adrian returned an incompatible policy login response.";
 if(code==="adrian_policy_alert_mode")return "Adrian connection succeeded, but this Adrian profile is in Alert mode. Switch it to Block mode for ADT enforcement.";
 if(code==="adrian_policy_hitl_unsupported")return "Adrian connection succeeded, but Human Review mode is not supported by ADT yet. Use Block mode.";
 if(code==="adrian_policy_unspecified")return "Adrian connection succeeded, but no supported enforcement policy mode is active. Use Block mode.";
 if(code==="adrian_sdk_readiness_failed")return "Adrian authentication and policy login succeeded, but the ADT Runtime Adrian SDK did not become ready.";
 return "Security enforcement is unavailable.";
}
