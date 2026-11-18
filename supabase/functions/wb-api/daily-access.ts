import { ApiError } from './core.ts';

// Legacy default checks are retained for isolated callers. Live browser routes
// use section grants; background collection follows existing-shop eligibility.
export const DAILY_USER_ID = 'bbb002c4-cd7a-490d-b9c0-72aed5424261';
const shopIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function dailyAllowed(userId: string, shopId: string) {
  return userId === DAILY_USER_ID && typeof shopId === 'string' && shopIdPattern.test(shopId);
}
export function authorizeDaily(userId: string, shopId: string) {
  if (!dailyAllowed(userId,shopId)) throw new ApiError(403,'Тестовая аналитика недоступна');
}
export async function privateShopAllowed(admin: any, shopId: string,section='daily') {
  const {data,error}=await admin.rpc('app_shop_section_enabled',{p_shop_id:shopId,p_section:section});
  if(error)throw new ApiError(500,'Не удалось проверить доступ к дополнительным разделам');
  return data===true;
}
