/** Explicit native coding composition for the existing AUKORA Web preset. */
export declare const WEB_OPERATOR_REQUIRED_HOST_IDS: readonly string[];
/** Validate enabled host prerequisites without mounting services. */
export declare function assertWebOperatorHost(hostPluginIds: Iterable<string>, platform: string): void;
/** Default false preserves exact restricted bytes; true selects literal, native coding rows. */
export declare function composeWebOperatorPreset(options: {
  aukoraPreset: string;
  standardPreset: string;
  platform: string;
  operatorCoding: boolean;
}): string;
