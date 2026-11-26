/**
 * The owner's commercial settings (docs/architecture/commercial-settings.md, slice 3; ADM-006): a closed
 * list of keys, each versioned with effective dates and a change log, recorded only by the development
 * owner, and read where the code once held a constant. It loads no database client when it is imported,
 * so the drafting assistant reads it without one; the owner's screen for it is in `commerce`.
 */
export {
  COMMERCIAL_SETTINGS,
  COMMERCIAL_SETTING_KEYS,
  commercialSettingStatus,
  commercialSettingTerms,
  commercialSettingTermsId,
  commercialSettingValue,
  recordCommercialSettingIn,
  type CommercialSettingApproval,
  type CommercialSettingKey,
  type CommercialSettingTerms,
} from "./settings";
