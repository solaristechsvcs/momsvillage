import React from 'react';
import { createRoot } from 'react-dom/client';
import { FaceLivenessDetectorCore } from '@aws-amplify/ui-react-liveness';
import { ThemeProvider } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

let csrf='';
const rootElement=document.getElementById('camera-root');
const heading=document.getElementById('camera-status');
async function request(path,method='GET',body) {
  const response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || 'Verification is unavailable.');
  return result;
}
const attemptId=new URLSearchParams(location.search).get('attempt');
let root;
async function finish() {
  heading.textContent='Checking your result…';
  for(let n=0;n<15;n++) {
    const result=await request('/verification/attempts/'+attemptId+'/complete','POST',{});
    if(result.status!=='in_progress') {
      root?.unmount(); location.replace('/#verification');return;
    }
    await new Promise(resolve=>setTimeout(resolve,800));
  }
  root?.unmount(); heading.textContent='The result is not ready yet. Return to your verification page to check or retry.';
}
async function cancel() {
  root?.unmount();
  try {await request('/verification','DELETE');} finally {location.replace('/#verification');}
}
try {
  if(!window.isSecureContext) throw new Error('The camera check requires HTTPS.');
  const session=await request('/session'); csrf=session.csrf;
  if(!session.user || session.user.membership_status!=='approved') throw new Error('Sign in with an approved membership before starting verification.');
  if(!attemptId || !/^[a-f0-9-]{36}$/.test(attemptId)) throw new Error('Start a new attempt from the Verification page.');
  const attempt=await request('/verification/attempts/'+attemptId);
  root=createRoot(rootElement);
  heading.textContent='Follow the camera instructions. You can cancel at any time.';
  root.render(<ThemeProvider><FaceLivenessDetectorCore
    sessionId={attempt.sessionId} region={attempt.region}
    config={{credentialProvider:async()=>{
      const c=await request('/verification/attempts/'+attemptId+'/credentials','POST',{});
      return {...c,expiration:c.expiration?new Date(c.expiration):undefined};
    }}}
    onAnalysisComplete={finish}
    onUserCancel={()=>void cancel()}
    onError={()=>{ heading.textContent='The camera check could not finish. Cancel this attempt, then start a new check when ready.'; }}
  /></ThemeProvider>);
} catch(error) { heading.textContent=error.message; }
document.getElementById('cancel-camera').addEventListener('click',()=>void cancel().catch(()=>{location.replace('/#verification');}));
window.addEventListener('pagehide',()=>root?.unmount());
