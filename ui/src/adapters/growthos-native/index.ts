import type { UIAdapterModule } from "../types";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

export const growthosNativeUIAdapter: UIAdapterModule = {
  type: "growthos_native",
  label: "GrowthOS Native",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};
