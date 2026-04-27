import type { ServerAdapterModule } from "../types.js";

const adapterConfigurationDoc = `# growthos_native agent configuration

Adapter: growthos_native

GrowthOS owns execution for this adapter. Paperclip remains the control plane for
companies, agents, issues, documents, approvals, budgets, and heartbeat runs.

Required fields:
- growthosApiBaseUrl (string): GrowthOS API base URL.
- tenantId (string): GrowthOS tenant identifier. In GrowthOS this maps to the Paperclip company id.

Optional fields:
- sessionBudgetCents (number): per-run execution budget cap enforced by GrowthOS.
`;

export const growthosNativeAdapter: ServerAdapterModule = {
  type: "growthos_native",
  execute: async (ctx) => {
    await ctx.onLog(
      "stderr",
      [
        "growthos_native execution is delegated to GrowthOS.",
        "Paperclip registered this adapter type so GrowthOS-created agents are valid.",
        "Configure the GrowthOS heartbeat worker before invoking this adapter directly.",
        "",
      ].join("\n"),
    );

    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "growthos_native execution must be handled by the GrowthOS worker.",
      resultJson: {
        adapterType: "growthos_native",
        runId: ctx.runId,
        agentId: ctx.agent.id,
      },
    };
  },
  testEnvironment: async () => ({
    adapterType: "growthos_native",
    status: "warn",
    checks: [
      {
        code: "growthos.execution_delegate",
        level: "warn",
        message: "Execution is delegated to the GrowthOS worker.",
        hint: "Run the GrowthOS API and worker processes before invoking growthos_native agents.",
      },
    ],
    testedAt: new Date().toISOString(),
  }),
  models: [],
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: adapterConfigurationDoc,
};
