/** The hosts the policy file lists. A guide's sources, its links and the places searched for later
 * amendments must be on one of them. The guidance policy checks that the file lists each
 * (modules/publication/guidance-policy.ts). It lives here, outside both modules, so that the sources
 * module's fetcher reads it too, and reading it loads neither module. */
export const guidanceOfficialHosts = [
  "icrp.cac.gov.ng",
  "www.cac.gov.ng",
  "nass.gov.ng",
  "www.nrs.gov.ng",
  "taxid.nrs.gov.ng",
  "ndpc.gov.ng",
  "www.ncc.gov.ng",
  "fccpc.gov.ng",
  "nafdac.gov.ng",
  "www.nafdac.gov.ng",
  "www.pencom.gov.ng",
  "nipc.gov.ng",
  "m.nipc.gov.ng",
  "fmino.gov.ng",
  "budgetoffice.gov.ng",
] as const;
