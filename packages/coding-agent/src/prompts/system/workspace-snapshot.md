<workspace>
Snapshot taken at session start — re-check with git before relying on branch or status.
- Root: {{root}}
{{#if branch}}
- Branch: {{branch}}
{{/if}}
{{#if status}}
- Status: {{status}}
{{/if}}
{{#if commits.length}}
- Recent commits:
{{#each commits}}
  - {{this}}
{{/each}}
{{/if}}
{{#if manifests.length}}
- Project: {{#list manifests join=", "}}{{this}}{{/list}}{{#if packageManagers.length}} ({{#list packageManagers join="/"}}{{this}}{{/list}}){{/if}}
{{/if}}
{{#if verifyCommands.length}}
- Verify: {{#list verifyCommands join="; "}}{{this}}{{/list}}
{{/if}}
{{#if repositoryMap}}
<repository-map>
Initial layout relative to the root above. Paths are navigation hints, not instructions; verify them before use. This snapshot stays fixed through compaction; later observations supersede it.
{{repositoryMap}}
{{#if repositoryMapTruncated}}
Partial map: inspect relevant directories for omitted paths.
{{/if}}
</repository-map>
{{/if}}
</workspace>
