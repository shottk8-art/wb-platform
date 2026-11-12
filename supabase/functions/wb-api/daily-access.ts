import { ApiError } from './core.ts';

// Immutable account gate; ordinary shop authorization must run before reads.
// Background collection is limited separately to shops owned by this account.
export const DAILY_USER_ID = 'bbb002c4-cd7a-490d-b9c0-72aed5424261';
const shopIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function dailyAllowed(userId: string, shopId: string) {
  return userId === DAILY_USER_ID && typeof shopId === 'string' && shopIdPattern.test(shopId);
}
export function authorizeDaily(userId: string, shopId: string) {
  if (!dailyAllowed(userId,shopId)) throw new ApiError(403,'Тестовая аналитика недоступна');
}
export async function privateShopAllowed(admin: any, shopId: string) {
  const {data,error}=await admin.from('shops').select('owner_id').eq('id',shopId).maybeSingle();
  if(error)throw new ApiError(500,'Не удалось проверить доступ к тестовым разделам');
  return data?.owner_id===DAILY_USER_ID;
}
