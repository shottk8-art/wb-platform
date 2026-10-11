import { ApiError, validateShopId } from './core.ts';

// Every browser action crosses this seam before any service-role data read.
// Public storefront visibility is not membership and never grants API access.
export async function authorizeShop(admin: any, shopId: string, userId: string, action: string) {
  validateShopId(shopId);
  const {data:shop,error} = await admin.from('shops').select('id,owner_id').eq('id',shopId).maybeSingle();
  if (error || !shop || shop.id !== shopId) throw new ApiError(403,'Магазин недоступен');
  const owner = shop.owner_id === userId;
  if (!owner) {
    const {data:member,error:memberError} = await admin.from('shop_members').select('user_id').eq('shop_id',shopId).eq('user_id',userId).maybeSingle();
    if (memberError || !member || member.user_id !== userId) throw new ApiError(403,'Магазин недоступен');
  }
  if (!owner && ['connect','check','disconnect'].includes(action)) throw new ApiError(403,'Подключением API управляет владелец магазина');
  return shop;
}
