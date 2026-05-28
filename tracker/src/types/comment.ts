export interface Comment {
  id: string;
  issueIdentifier: string;
  author: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  body: string;
}
