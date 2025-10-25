// Velo snippet (Invest page)
import wixLocation from 'wix-location';
import { fetch } from 'wix-fetch';
const API = 'https://YOUR-API-URL';
export async function kycButton_click(){
  const email = $w('#email').value;
  const r = await fetch(`${API}/api/kyc/start`, { method:'post', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
  const data = await r.json();
  $w('#status').text = data.status || data.error || 'ok';
}
export async function invest100_click(){
  const email = $w('#email').value;
  const r = await fetch(`${API}/api/checkout`, { method:'post', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amountUSD:100, email }) });
  const data = await r.json();
  if(data.url) wixLocation.to(data.url); else $w('#status').text = data.error || 'failed';
}