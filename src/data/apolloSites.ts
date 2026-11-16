import landingSites from './landingSites.json';

export type ApolloSite = typeof landingSites[number];
export type SiteLocation = Pick<ApolloSite, 'id' | 'name' | 'lat' | 'lon'>;
export const APOLLO_SITES: ApolloSite[] = landingSites;
