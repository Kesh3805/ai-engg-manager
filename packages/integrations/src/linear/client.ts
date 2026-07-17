import { LinearClient, LinearDocument } from '@linear/sdk';

export function getLinearClient(accessToken: string): LinearClient {
  return new LinearClient({ accessToken });
}

export async function fetchIssuesByTeam(client: LinearClient, teamId: string) {
  const issues = await client.issues({
    filter: { team: { id: { eq: teamId } } },
    orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
  });
  return issues.nodes;
}
