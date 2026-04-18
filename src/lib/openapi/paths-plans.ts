/**
 * OpenAPI path definitions for persisted execution plans.
 */

export const plansPaths = {
  "/api/plans": {
    get: {
      tags: ["Plans"],
      summary: "List persisted plans for a repository",
      description:
        "Returns persisted execution-plan summaries for one repository. " +
        "Use this to discover available plan ids before loading a full " +
        "plan record.",
      operationId: "listPlans",
      parameters: [
        {
          name: "repoPath",
          in: "query",
          required: true,
          schema: { type: "string" },
          description:
            "Absolute repository path. The `_repo` query alias is also " +
            "accepted at runtime for compatibility.",
        },
      ],
      responses: {
        "200": {
          description: "Persisted plan summaries",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PlanSummary" },
                  },
                },
              },
              examples: {
                success: {
                  value: {
                    data: [
                      {
                        artifact: {
                          id: "repo-plan-1",
                          type: "execution_plan",
                          state: "design",
                          workflowId: "execution_plan_sdlc",
                          createdAt: "2026-04-17T12:34:56Z",
                          updatedAt: "2026-04-17T12:34:56Z",
                        },
                        plan: {
                          repoPath: "/path/to/repo",
                          beatIds: ["foolery-1234", "foolery-5678"],
                          objective: "Deliver the execution-plan API docs",
                          summary:
                            "Refresh docs and OpenAPI output for external consumers.",
                          mode: "groom",
                          model: "gpt-5.4",
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Missing repoPath",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                missingRepo: {
                  value: { error: "repoPath is required" },
                },
              },
            },
          },
        },
        "500": {
          description: "Plan listing failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                listingFailed: {
                  value: { error: "Failed to list execution plans." },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Plans"],
      summary: "Create and persist an immutable execution plan",
      description:
        "Generates a wave/step execution plan from a selected set of beats, " +
        "persists it as an `execution_plan` knot, and returns the full plan " +
        "record with live derived progress.",
      operationId: "createPlan",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreatePlanRequest" },
            examples: {
              createPlan: {
                value: {
                  repoPath: "/path/to/repo",
                  beatIds: ["foolery-1234", "foolery-5678"],
                  objective:
                    "Deliver the execution-plan API docs as a polished guide",
                  mode: "groom",
                  model: "gpt-5.4",
                  replacesPlanId: "repo-plan-0",
                },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Persisted plan created with execution guidance",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreatePlanResponse",
              },
              examples: {
                created: {
                  value: {
                    data: {
                      artifact: {
                        id: "repo-plan-1",
                        type: "execution_plan",
                        state: "design",
                        workflowId: "execution_plan_sdlc",
                        createdAt: "2026-04-17T12:34:56Z",
                        updatedAt: "2026-04-17T12:34:56Z",
                      },
                      plan: {
                        repoPath: "/path/to/repo",
                        beatIds: ["foolery-1234", "foolery-5678"],
                        objective:
                          "Deliver the execution-plan API docs as a polished guide",
                        summary:
                          "Refresh docs and OpenAPI output for external consumers.",
                        assumptions: [
                          "Beat ownership and acceptance criteria are already correct.",
                        ],
                        unassignedBeatIds: [],
                        mode: "groom",
                        model: "gpt-5.4",
                        waves: [
                          {
                            waveIndex: 1,
                            name: "Refresh the consumer-facing contract",
                            objective: "Align docs and machine-readable spec",
                            agents: [
                              {
                                role: "doc-writer",
                                count: 1,
                                specialty: "REST API docs",
                              },
                            ],
                            beats: [
                              {
                                id: "foolery-1234",
                                title: "Rewrite docs/API.md",
                              },
                              {
                                id: "foolery-5678",
                                title: "Enrich /api/openapi.json contract",
                              },
                            ],
                            steps: [
                              {
                                stepIndex: 1,
                                beatIds: ["foolery-1234"],
                                notes: "Rewrite docs/API.md",
                              },
                              {
                                stepIndex: 2,
                                beatIds: ["foolery-5678"],
                                notes: "Update OpenAPI descriptions and examples",
                              },
                            ],
                          },
                        ],
                      },
                      progress: {
                        generatedAt: "2026-04-17T12:35:00Z",
                        completionRule: "shipped",
                        beatStates: [
                          {
                            beatId: "foolery-1234",
                            title: "Rewrite docs/API.md",
                            state: "ready_for_implementation",
                            satisfied: false,
                          },
                          {
                            beatId: "foolery-5678",
                            title: "Enrich /api/openapi.json contract",
                            state: "ready_for_implementation",
                            satisfied: false,
                          },
                        ],
                        satisfiedBeatIds: [],
                        remainingBeatIds: [
                          "foolery-1234",
                          "foolery-5678",
                        ],
                        nextStep: {
                          waveIndex: 1,
                          stepIndex: 1,
                          beatIds: ["foolery-1234"],
                          notes: "Rewrite docs/API.md",
                        },
                        waves: [
                          {
                            waveIndex: 1,
                            complete: false,
                            steps: [
                              {
                                waveIndex: 1,
                                stepIndex: 1,
                                beatIds: ["foolery-1234"],
                                notes: "Rewrite docs/API.md",
                                complete: false,
                                satisfiedBeatIds: [],
                                remainingBeatIds: ["foolery-1234"],
                              },
                              {
                                waveIndex: 1,
                                stepIndex: 2,
                                beatIds: ["foolery-5678"],
                                notes:
                                  "Update OpenAPI descriptions and examples",
                                complete: false,
                                satisfiedBeatIds: [],
                                remainingBeatIds: ["foolery-5678"],
                              },
                            ],
                          },
                        ],
                      },
                      lineage: {
                        replacesPlanId: "repo-plan-0",
                        replacedByPlanIds: [],
                      },
                      skillPrompt: "# Execution Plan Skill\n\n...",
                    },
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                invalidRequest: {
                  value: { error: "beatIds is required" },
                },
              },
            },
          },
        },
        "500": {
          description: "Plan generation or persistence failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                createFailed: {
                  value: { error: "Failed to create execution plan knot." },
                },
              },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}": {
    get: {
      tags: ["Plans"],
      summary: "Get one persisted plan with derived progress",
      description:
        "Loads one persisted execution plan and recomputes progress from the " +
        "current state of each beat in the plan. Use this endpoint to refresh " +
        "the next actionable step while work is in flight.",
      operationId: "getPlan",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description:
            "Plan identifier returned in `artifact.id`. Prefer the exact " +
            "value returned by `POST /api/plans`.",
        },
        {
          name: "repoPath",
          in: "query",
          required: false,
          schema: { type: "string" },
          description:
            "Optional repository hint used to disambiguate reads when " +
            "multiple registered repos could match the same plan id. The " +
            "`_repo` query alias is also accepted at runtime.",
        },
      ],
      responses: {
        "200": {
          description: "Persisted plan and derived progress",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    $ref: "#/components/schemas/PersistedPlan",
                  },
                },
              },
              examples: {
                success: {
                  value: {
                    data: {
                      artifact: {
                        id: "repo-plan-1",
                        type: "execution_plan",
                        state: "design",
                        workflowId: "execution_plan_sdlc",
                        createdAt: "2026-04-17T12:34:56Z",
                        updatedAt: "2026-04-17T12:40:00Z",
                      },
                      plan: {
                        repoPath: "/path/to/repo",
                        beatIds: ["foolery-1234", "foolery-5678"],
                        objective:
                          "Deliver the execution-plan API docs as a polished guide",
                        summary:
                          "Refresh docs and OpenAPI output for external consumers.",
                        assumptions: [],
                        unassignedBeatIds: [],
                        waves: [],
                      },
                      progress: {
                        generatedAt: "2026-04-17T12:40:00Z",
                        completionRule: "shipped",
                        beatStates: [
                          {
                            beatId: "foolery-1234",
                            state: "shipped",
                            satisfied: true,
                          },
                          {
                            beatId: "foolery-5678",
                            state: "ready_for_implementation",
                            satisfied: false,
                          },
                        ],
                        satisfiedBeatIds: ["foolery-1234"],
                        remainingBeatIds: ["foolery-5678"],
                        nextStep: {
                          waveIndex: 1,
                          stepIndex: 2,
                          beatIds: ["foolery-5678"],
                        },
                        waves: [],
                      },
                      lineage: {
                        replacedByPlanIds: [],
                      },
                      skillPrompt: "# Execution Plan Skill\n\n...",
                    },
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Invalid read request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "409": {
          description: "Ambiguous plan id; provide repoPath",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                ambiguousPlanId: {
                  value: {
                    error:
                      "Multiple plans match plan-1; provide repoPath to disambiguate.",
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                notFound: {
                  value: { error: "Plan not found" },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
