// Small owner lookup for legacy worker fixtures; finance mocks stay unchanged.
export function shopOwnerQuery(ownerId = 'regular-owner') {
  const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{owner_id:ownerId},error:null})};
  return q;
}
