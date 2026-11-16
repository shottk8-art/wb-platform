import {ApiError} from './core.ts';

// Retry is a delay, Reset is the time until the whole burst is replenished.
// Never use Reset as Retry or shorten a previously persisted seller cooldown.
export function retrySeconds(headers:Headers, minimum=63, now=Date.now()) {
  const wb=headers.get('X-Ratelimit-Retry'),standard=headers.get('Retry-After');
  let seconds=wb!=null&&/^\d+(?:\.\d+)?$/.test(wb)?Number(wb):NaN;
  if(!Number.isFinite(seconds)&&standard!=null){
    seconds=/^\d+(?:\.\d+)?$/.test(standard)?Number(standard):(Date.parse(standard)-now)/1000;
  }
  return Number.isFinite(seconds)&&seconds>=0?Math.max(minimum,Math.ceil(seconds)):minimum;
}

export async function deferRequest(admin:any,shopId:string,seconds:number,limited=true) {
  const {error}=await admin.rpc('wb_api_defer_request',{p_shop_id:shopId,p_seconds:Math.ceil(seconds),p_limited:limited});
  if(error)throw new ApiError(500,'Не удалось сохранить время ожидания WB');
}
