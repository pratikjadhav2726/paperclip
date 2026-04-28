import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.ts";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
  getAncestors: vi.fn(),
  getCommentCursor: vi.fn(),
  getComment: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  listLabels: vi.fn(),
  createLabel: vi.fn(),
  getLabelById: vi.fn(),
  deleteLabel: vi.fn(),
  findMentionedAgents: vi.fn(),
  getRelationSummaries: vi.fn(),
  listBlockerAttention: vi.fn(),
  listAttachments: vi.fn(),
  listComments: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  archiveInbox: vi.fn(),
  unarchiveInbox: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(async () => false),
  hasPermission: vi.fn(async () => false),
}));
const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));
const mockFeedbackService = vi.hoisted(() => ({
  listIssueVotesForUser: vi.fn(async () => []),
  saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
}));
const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    id: "instance-settings-1",
    general: {
      censorUsernameInLogs: false,
      feedbackDataSharingPreference: "prompt",
    },
  })),
  listCompanyIds: vi.fn(async () => ["company-1"]),
}));
const mockRoutineService = vi.hoisted(() => ({
  syncRunStatusForIssue: vi.fn(async () => undefined),
}));
const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
  listByIds: vi.fn(async () => []),
}));
const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
  getDefaultCompanyGoal: vi.fn(async () => null),
}));
const mockDocumentService = vi.hoisted(() => ({
  getIssueDocumentPayload: vi.fn(async () => ({})),
  listIssueDocuments: vi.fn(async () => []),
  getIssueDocumentByKey: vi.fn(async () => null),
  listIssueDocumentRevisions: vi.fn(async () => []),
}));
const mockExecutionWorkspaceService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
}));
const mockWorkProductService = vi.hoisted(() => ({
  listForIssue: vi.fn(async () => []),
}));
const mockIssueReferenceService = vi.hoisted(() => ({
  deleteDocumentSource: vi.fn(async () => undefined),
  diffIssueReferenceSummary: vi.fn(() => ({
    addedReferencedIssues: [],
    removedReferencedIssues: [],
    currentReferencedIssues: [],
  })),
  emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
  listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
  syncComment: vi.fn(async () => undefined),
  syncDocument: vi.fn(async () => undefined),
  syncIssue: vi.fn(async () => undefined),
}));
const mockIssueThreadInteractionService = vi.hoisted(() => ({
  listForIssue: vi.fn(async () => []),
}));
const mockIssueApprovalService = vi.hoisted(() => ({
  listApprovalsForIssue: vi.fn(async () => []),
  link: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));
const mockWithCompanyRls = vi.hoisted(() =>
  vi.fn(async (_db: unknown, _companyId: string, operation: (scopedDb: unknown) => Promise<unknown>) =>
    operation({ scoped: true }),
  ),
);

function registerModuleMocks() {
  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/feedback.js", () => ({
    feedbackService: () => mockFeedbackService,
  }));

  vi.doMock("../services/heartbeat.js", () => ({
    heartbeatService: () => mockHeartbeatService,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));

  vi.doMock("../services/routines.js", () => ({
    routineService: () => mockRoutineService,
  }));
  vi.doMock("../services/company-rls.js", () => ({
    withCompanyRls: mockWithCompanyRls,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => ({
      getById: vi.fn(async () => null),
    }),
    documentService: () => mockDocumentService,
    executionWorkspaceService: () => mockExecutionWorkspaceService,
    feedbackService: () => mockFeedbackService,
    goalService: () => mockGoalService,
    heartbeatService: () => mockHeartbeatService,
    instanceSettingsService: () => mockInstanceSettingsService,
    issueApprovalService: () => mockIssueApprovalService,
    issueThreadInteractionService: () => mockIssueThreadInteractionService,
    issueReferenceService: () => mockIssueReferenceService,
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    projectService: () => mockProjectService,
    routineService: () => mockRoutineService,
    workProductService: () => mockWorkProductService,
  }));
}

async function createApp(
  actor: Record<string, unknown> = {
    type: "board",
    userId: "local-board",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: false,
  },
) {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    status: "todo",
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "PAP-580",
    title: "Activity event issue",
    executionPolicy: null,
    executionState: null,
  };
}

describe("issue activity event routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/access.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../services/feedback.js");
    vi.doUnmock("../services/heartbeat.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/instance-settings.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/routines.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.list.mockResolvedValue([]);
    mockIssueService.listLabels.mockResolvedValue([]);
    mockIssueService.createLabel.mockResolvedValue({
      id: "label-1",
      companyId: "company-1",
      name: "Backend",
      color: "#2563eb",
    });
    mockIssueService.getLabelById.mockResolvedValue({
      id: "label-1",
      companyId: "company-1",
      name: "Backend",
      color: "#2563eb",
    });
    mockIssueService.deleteLabel.mockResolvedValue({
      id: "label-1",
      companyId: "company-1",
      name: "Backend",
      color: "#2563eb",
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue(null);
    mockIssueService.getComment.mockResolvedValue(null);
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.listBlockerAttention.mockResolvedValue(new Map());
    mockIssueService.listAttachments.mockResolvedValue([]);
    mockIssueService.listComments.mockResolvedValue([]);
    mockIssueService.markRead.mockResolvedValue({ issueId: "11111111-1111-4111-8111-111111111111", lastReadAt: new Date() });
    mockIssueService.markUnread.mockResolvedValue(true);
    mockIssueService.archiveInbox.mockResolvedValue({ issueId: "11111111-1111-4111-8111-111111111111", archivedAt: new Date() });
    mockIssueService.unarchiveInbox.mockResolvedValue({ ok: true });
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockFeedbackService.listIssueVotesForUser.mockResolvedValue([]);
    mockFeedbackService.saveIssueVote.mockResolvedValue({
      vote: null,
      consentEnabledNow: false,
      sharingEnabled: false,
    });
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockResolvedValue(undefined);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockInstanceSettingsService.get.mockResolvedValue({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    });
    mockInstanceSettingsService.listCompanyIds.mockResolvedValue(["company-1"]);
    mockRoutineService.syncRunStatusForIssue.mockResolvedValue(undefined);
    mockIssueApprovalService.listApprovalsForIssue.mockResolvedValue([]);
    mockIssueApprovalService.link.mockResolvedValue(undefined);
    mockIssueApprovalService.unlink.mockResolvedValue(undefined);
  });

  it("logs blocker activity with added and removed issue summaries", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const previousRelations = {
      blockedBy: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          identifier: "PAP-10",
          title: "Old blocker",
          status: "todo",
          priority: "medium",
          assigneeAgentId: null,
          assigneeUserId: null,
        },
      ],
      blocks: [],
    };
    const nextRelations = {
      blockedBy: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          identifier: "PAP-11",
          title: "New blocker",
          status: "todo",
          priority: "medium",
          assigneeAgentId: null,
          assigneeUserId: null,
        },
      ],
      blocks: [],
    };
    let relationLookupCount = 0;
    mockIssueService.getRelationSummaries.mockImplementation(async () => {
      relationLookupCount += 1;
      return relationLookupCount === 1 ? previousRelations : nextRelations;
    });
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ blockedByIssueIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.blockers_updated",
          details: expect.objectContaining({
            addedBlockedByIssueIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
            removedBlockedByIssueIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            addedBlockedByIssues: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                identifier: "PAP-11",
                title: "New blocker",
              },
            ],
            removedBlockedByIssues: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                identifier: "PAP-10",
                title: "Old blocker",
              },
            ],
          }),
        }),
      );
    });
  }, 15_000);

  it("logs explicit reviewer and approver activity when execution policy participants change", async () => {
    const existingPolicy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "11111111-2222-4333-8444-555555555555" }],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          type: "approval",
          participants: [{ type: "agent", agentId: "66666666-7777-4888-8999-aaaaaaaaaaaa" }],
        },
      ],
    })!;
    const nextPolicy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" }],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          type: "approval",
          participants: [{ type: "user", userId: "local-board" }],
        },
      ],
    })!;
    const issue = {
      ...makeIssue(),
      executionPolicy: existingPolicy,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      executionPolicy: patch.executionPolicy,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ executionPolicy: nextPolicy });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.reviewers_updated",
          details: expect.objectContaining({
            participants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", userId: null }],
            addedParticipants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", userId: null }],
            removedParticipants: [{ type: "agent", agentId: "11111111-2222-4333-8444-555555555555", userId: null }],
          }),
        }),
      );
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.approvers_updated",
          details: expect.objectContaining({
            participants: [{ type: "user", agentId: null, userId: "local-board" }],
            addedParticipants: [{ type: "user", agentId: null, userId: "local-board" }],
            removedParticipants: [{ type: "agent", agentId: "66666666-7777-4888-8999-aaaaaaaaaaaa", userId: null }],
          }),
        }),
      );
    });
  });

  it("enters company RLS scope for issue labels list and create", async () => {
    const app = await createApp();
    const listRes = await request(app).get("/api/companies/company-1/labels");
    expect(listRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));

    const createRes = await request(app).post("/api/companies/company-1/labels").send({
      name: "Backend",
      color: "#2563eb",
    });
    expect(createRes.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.createLabel).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ name: "Backend", color: "#2563eb" }),
    );
  });

  it("checks company access before entering RLS scope for labels list", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });
    const res = await request(app).get("/api/companies/company-1/labels");
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueService.listLabels).not.toHaveBeenCalled();
  });

  it("enters company RLS scope for issue detail reads", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp();

    const detailRes = await request(app).get(`/api/issues/${issue.id}`);
    expect(detailRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.getAncestors).toHaveBeenCalledWith(issue.id);
  });

  it("checks access before entering RLS scope for issues list", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });
    const res = await request(app).get("/api/companies/company-1/issues");
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });

  it("enters company RLS scope for heartbeat-context, documents, and work-products reads", async () => {
    const issue = {
      ...makeIssue(),
      executionWorkspaceId: null,
      projectId: null,
      goalId: null,
      parentId: null,
      description: null,
      priority: "medium",
      updatedAt: new Date(),
    };
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp();

    const heartbeatRes = await request(app).get(`/api/issues/${issue.id}/heartbeat-context`);
    expect(heartbeatRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.getCommentCursor).toHaveBeenCalledWith(issue.id);

    const documentsRes = await request(app).get(`/api/issues/${issue.id}/documents`);
    expect(documentsRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockDocumentService.listIssueDocuments).toHaveBeenCalledWith(issue.id, { includeSystem: false });

    const workProductsRes = await request(app).get(`/api/issues/${issue.id}/work-products`);
    expect(workProductsRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockWorkProductService.listForIssue).toHaveBeenCalledWith(issue.id);
  });

  it("checks access before entering RLS scope for heartbeat-context", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });

    const res = await request(app).get(`/api/issues/${issue.id}/heartbeat-context`);
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueService.getCommentCursor).not.toHaveBeenCalled();
  });

  it("enters company RLS scope for document key/revisions and thread reads", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue({
      id: "doc-1",
      issueId: issue.id,
      key: "summary",
      title: "Summary",
      format: "markdown",
      body: "Body",
      latestRevisionId: "rev-1",
      latestRevisionNumber: 1,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    mockDocumentService.listIssueDocumentRevisions.mockResolvedValue([
      {
        id: "rev-1",
        documentId: "doc-1",
        issueId: issue.id,
        key: "summary",
        revisionNumber: 1,
      },
    ]);
    const app = await createApp();

    const docRes = await request(app).get(`/api/issues/${issue.id}/documents/summary`);
    expect(docRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockDocumentService.getIssueDocumentByKey).toHaveBeenCalledWith(issue.id, "summary");

    const revisionsRes = await request(app).get(`/api/issues/${issue.id}/documents/summary/revisions`);
    expect(revisionsRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockDocumentService.listIssueDocumentRevisions).toHaveBeenCalledWith(issue.id, "summary");

    const commentsRes = await request(app).get(`/api/issues/${issue.id}/comments`);
    expect(commentsRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.listComments).toHaveBeenCalledWith(issue.id, {
      afterCommentId: null,
      order: "desc",
      limit: null,
    });

    const interactionsRes = await request(app).get(`/api/issues/${issue.id}/interactions`);
    expect(interactionsRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueThreadInteractionService.listForIssue).toHaveBeenCalledWith(issue.id);
  });

  it("checks access before entering RLS scope for issue comments", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });
    const res = await request(app).get(`/api/issues/${issue.id}/comments`);
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueService.listComments).not.toHaveBeenCalled();
  });

  it("enters company RLS scope for read and inbox archive mutations", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp();

    const markReadRes = await request(app).post(`/api/issues/${issue.id}/read`);
    expect(markReadRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.markRead).toHaveBeenCalled();

    const markUnreadRes = await request(app).delete(`/api/issues/${issue.id}/read`);
    expect(markUnreadRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.markUnread).toHaveBeenCalledWith("company-1", issue.id, "local-board");

    const archiveRes = await request(app).post(`/api/issues/${issue.id}/inbox-archive`);
    expect(archiveRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.archiveInbox).toHaveBeenCalled();

    const unarchiveRes = await request(app).delete(`/api/issues/${issue.id}/inbox-archive`);
    expect(unarchiveRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueService.unarchiveInbox).toHaveBeenCalledWith("company-1", issue.id, "local-board");
  });

  it("checks access before entering RLS scope for read mutation", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });
    const res = await request(app).post(`/api/issues/${issue.id}/read`);
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueService.markRead).not.toHaveBeenCalled();
  });

  it("enters company RLS scope for issue approvals list/link/unlink", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueApprovalService.listApprovalsForIssue.mockResolvedValue([
      { id: "11111111-2222-4333-8444-555555555555", issueId: issue.id },
    ]);
    const app = await createApp();

    const listRes = await request(app).get(`/api/issues/${issue.id}/approvals`);
    expect(listRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueApprovalService.listApprovalsForIssue).toHaveBeenCalledWith(issue.id);

    const linkRes = await request(app)
      .post(`/api/issues/${issue.id}/approvals`)
      .send({ approvalId: "11111111-2222-4333-8444-555555555555" });
    expect(linkRes.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueApprovalService.link).toHaveBeenCalledWith(
      issue.id,
      "11111111-2222-4333-8444-555555555555",
      expect.objectContaining({ userId: "local-board" }),
    );

    const unlinkRes = await request(app).delete(
      `/api/issues/${issue.id}/approvals/11111111-2222-4333-8444-555555555555`,
    );
    expect(unlinkRes.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockIssueApprovalService.unlink).toHaveBeenCalledWith(
      issue.id,
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("checks access before entering RLS scope for issue approvals list", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    const app = await createApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-2",
      runId: null,
    });
    const res = await request(app).get(`/api/issues/${issue.id}/approvals`);
    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.listApprovalsForIssue).not.toHaveBeenCalled();
  });
});
