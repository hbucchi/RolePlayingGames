// Every campaign. Add a campaign file next to this one and list it here; the campaign test checks it.
import { ashford } from './ashford.js';

export const CAMPAIGNS = [ashford];
export const CAMPAIGNS_BY_ID = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c]));
