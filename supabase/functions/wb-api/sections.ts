import {ApiError} from './core.ts';
export const PLATFORM_ADMIN='bbb002c4-cd7a-490d-b9c0-72aed5424261';
export async function requireSections(admin:any,userId:string,sections:string[]) {
 if(userId===PLATFORM_ADMIN)return;
 for(const section of sections){
  const {data,error}=await admin.rpc('app_section_allowed',{p_section:section,p_user_id:userId});
  if(error)throw new ApiError(500,'Не удалось проверить доступ к разделу');
  if(data===true)return;
 }
 throw new ApiError(403,'Доступ к разделу закрыт администратором');
}
export function actionSections(action:string){
 if(['daily','daily_start','unit','ozon_months'].includes(action))return ['daily'];
 if(action?.startsWith('stocks'))return ['stocks'];
 if(['status','cabinet_status'].includes(action))return ['overview','daily','stocks','settings','reports'];
 if(['connect','check','disconnect','preview_start','preview_step'].includes(action))return ['settings'];
 return ['overview'];
}
