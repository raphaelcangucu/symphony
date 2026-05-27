---
name: github-projects
description: |
  Use GitHub CLI and GraphQL for GitHub Projects v2 operations such as
  discovering project fields, adding issues or pull requests to projects, and
  updating project item fields.
---

# GitHub Projects

Use this skill for GitHub Projects v2 work during Symphony sessions.

## Primary tool

Use the GitHub CLI:

```bash
gh api graphql -f query='query or mutation document' -F variable=value
```

Tool behavior:

- Send one GraphQL operation per command.
- Treat a top-level `errors` array as a failed GraphQL operation even if `gh`
  exits successfully.
- Keep queries/mutations narrowly scoped; ask only for the fields you need.
- Prefer resolving project, field, option, item, and content ids from GraphQL
  instead of hardcoding ids.

## Discover project ids

Organization project:

```graphql
query OrganizationProject($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      title
      url
    }
  }
}
```

User project:

```graphql
query UserProject($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id
      title
      url
    }
  }
}
```

## Discover fields and options

Use this before updating item fields. Resolve fields by `name`, and resolve
single-select options by option `name`.

```graphql
query ProjectFields($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      title
      fields(first: 100) {
        nodes {
          ... on ProjectV2Field {
            id
            name
            dataType
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            dataType
            options {
              id
              name
            }
          }
          ... on ProjectV2IterationField {
            id
            name
            dataType
            configuration {
              iterations {
                id
                title
                startDate
                duration
              }
            }
          }
        }
      }
    }
  }
}
```

## Resolve issue or pull request content ids

Issue:

```graphql
query IssueContent($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      number
      title
      url
    }
  }
}
```

Pull request:

```graphql
query PullRequestContent($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      number
      title
      url
      state
    }
  }
}
```

## Add an issue or pull request to a project

Use `addProjectV2ItemById` with the project id and the issue/PR content id:

```graphql
mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item {
      id
    }
  }
}
```

If the content may already be in the project, query existing items first or
handle the duplicate-item GraphQL error explicitly.

## Find an existing project item

Use this to resolve a project item id before updating fields:

```graphql
query ProjectItems($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      items(first: 100) {
        nodes {
          id
          content {
            ... on Issue {
              id
              number
              title
              url
              repository {
                nameWithOwner
              }
            }
            ... on PullRequest {
              id
              number
              title
              url
              repository {
                nameWithOwner
              }
            }
          }
        }
      }
    }
  }
}
```

For large projects, paginate with `pageInfo { hasNextPage endCursor }` and an
`after` variable instead of assuming the first 100 items are complete.

## Update item fields

Single-select field, such as `Status` or `Priority`:

```graphql
mutation UpdateSingleSelectField(
  $projectId: ID!
  $itemId: ID!
  $fieldId: ID!
  $optionId: String!
) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
```

Text field:

```graphql
mutation UpdateTextField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: $text }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
```

Date field:

```graphql
mutation UpdateDateField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { date: $date }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
```

Number field:

```graphql
mutation UpdateNumberField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { number: $number }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
```

## Read current item field values

```graphql
query ProjectItemFieldValues($nodeId: ID!) {
  node(id: $nodeId) {
    ... on ProjectV2Item {
      id
      fieldValues(first: 50) {
        nodes {
          ... on ProjectV2ItemFieldTextValue {
            text
            field {
              ... on ProjectV2Field {
                name
              }
              ... on ProjectV2SingleSelectField {
                name
              }
              ... on ProjectV2IterationField {
                name
              }
            }
          }
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field {
              ... on ProjectV2Field {
                name
              }
              ... on ProjectV2SingleSelectField {
                name
              }
              ... on ProjectV2IterationField {
                name
              }
            }
          }
          ... on ProjectV2ItemFieldDateValue {
            date
            field {
              ... on ProjectV2Field {
                name
              }
              ... on ProjectV2SingleSelectField {
                name
              }
              ... on ProjectV2IterationField {
                name
              }
            }
          }
          ... on ProjectV2ItemFieldNumberValue {
            number
            field {
              ... on ProjectV2Field {
                name
              }
              ... on ProjectV2SingleSelectField {
                name
              }
              ... on ProjectV2IterationField {
                name
              }
            }
          }
        }
      }
    }
  }
}
```

## Usage rules

- Use `gh api graphql` for GitHub Projects v2 operations that are not covered
  cleanly by `gh project`.
- Prefer GraphQL for mutations so you can control and inspect exact ids.
- Resolve field ids and single-select option ids immediately before updates
  unless they were already fetched in the same session.
- Do not hardcode project field ids, option ids, or item ids in reusable code.
- Paginate project item queries when completeness matters.
- When mutating fields, verify the item after the mutation if later steps depend
  on the new project state.
