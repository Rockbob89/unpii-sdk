// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by packages/sdk/scripts/gen-types.ts from contract/openapi.json.
// Run `pnpm --filter @unpii/sdk gen:types` to regenerate after a contract change.

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AnonymizeRequest: {
            text: string;
            /** @enum {string} */
            markerFormat?: "default" | "custom" | "xxxxx" | "blackbar" | "pseudonym";
            turnstile_token?: string;
            /**
             * @default redact
             * @enum {string}
             */
            ambiguous: "redact" | "keep" | "mark";
            customMarkerMap?: {
                PERSON?: string;
                EMAIL?: string;
                PHONE?: string;
                ADDRESS?: string;
                DATE?: string;
                URL?: string;
                ACCOUNT?: string;
                SECRET?: string;
                UNKLAR?: string;
            };
            /**
             * @default auto
             * @enum {string}
             */
            structure: "auto" | "text" | "json" | "csv";
            keep?: ("DATE" | "URL")[];
            applyCustomRules?: boolean;
            applyAllowlist?: boolean;
        };
        AnonymizeResponse: {
            anonymized: string;
            spans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            uncertainSpans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            stats: {
                request_id: string;
                processed_chars: number;
                /** @enum {string} */
                servedBy: "slow" | "fast" | "gpu";
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                /** @enum {string} */
                structure: "text" | "json" | "csv";
                kept?: ("DATE" | "URL")[];
            };
            receipt: {
                /** @enum {number} */
                version: 1;
                issuedAt: string;
                requestId: string;
                model: string;
                processedChars: number;
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                outputSha256: string;
                rulesetHash: string | null;
                keyId: string;
                signature: string;
            } | null;
        };
        AnonymizeFileResponse: {
            file: {
                name: string;
                mimeType: string;
                contentBase64: string;
            };
            spans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            uncertainSpans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            warnings: {
                code: string;
                detail: string;
            }[];
            stats: {
                request_id: string;
                extractedChars: number;
                servedBy: string;
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                /** @enum {string} */
                structure: "text" | "json" | "csv";
                kept?: ("DATE" | "URL")[];
            };
            receipt: {
                /** @enum {number} */
                version: 1;
                issuedAt: string;
                requestId: string;
                model: string;
                processedChars: number;
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                outputSha256: string;
                rulesetHash: string | null;
                keyId: string;
                signature: string;
            } | null;
        };
        AnonymizeFileTextResponse: {
            text: string;
            spans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            uncertainSpans: {
                start: number;
                end: number;
                category: string;
                id: number;
                original: string;
                score?: number;
                source?: {
                    /** @enum {string} */
                    kind: "model" | "rule" | "custom_rule" | "coreference" | "propagation" | "gazetteer" | "anchor";
                    name?: string;
                };
            }[];
            warnings: {
                code: string;
                detail: string;
            }[];
            stats: {
                request_id: string;
                extractedChars: number;
                servedBy: string;
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                /** @enum {string} */
                structure: "text" | "json" | "csv";
                kept?: ("DATE" | "URL")[];
            };
            receipt: {
                /** @enum {number} */
                version: 1;
                issuedAt: string;
                requestId: string;
                model: string;
                processedChars: number;
                counts: {
                    [key: string]: number;
                };
                uncertainCount: number;
                outputSha256: string;
                rulesetHash: string | null;
                keyId: string;
                signature: string;
            } | null;
        };
        LimitsResponse: {
            current: {
                /** @enum {string} */
                tier: "anon" | "free" | "plus" | "pro" | "ultra";
                /** @enum {string} */
                channel: "web" | "api";
                daily_limit: number;
                entitled: boolean;
            };
            reference: {
                web: {
                    anon: number;
                    free: number;
                    plus: number;
                    pro: number;
                    ultra: number;
                };
                api: {
                    free: number;
                    plus: number;
                    pro: number;
                    ultra: number;
                };
            };
            burst: {
                magic_link_per_hour: number;
            };
            anonymize: {
                anonymous_per_day: number;
                user_per_day: number;
                apikey_per_day: number;
            };
            auth: {
                magic_link_per_hour: number;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

export type MarkerFormat = NonNullable<components["schemas"]["AnonymizeRequest"]["markerFormat"]>;
export type AmbiguousMode = NonNullable<components["schemas"]["AnonymizeRequest"]["ambiguous"]>;
export type AnonymizeResponse = components["schemas"]["AnonymizeResponse"];
export type Span = AnonymizeResponse["spans"][number];
export type AnonymizeStats = AnonymizeResponse["stats"];
export type AnonymizeFileResponse = components["schemas"]["AnonymizeFileResponse"];
export type AnonymizeFileTextResponse = components["schemas"]["AnonymizeFileTextResponse"];
export type FileWarning = AnonymizeFileResponse["warnings"][number];
export type LimitsResponse = components["schemas"]["LimitsResponse"];
