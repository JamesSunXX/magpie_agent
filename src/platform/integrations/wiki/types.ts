/** Represents a node in a Feishu wiki space tree. */
export interface WikiNode {
  nodeToken: string
  spaceId: string
  objToken: string
  /** 'doc' | 'docx' | 'sheet' | 'mindnote' | 'bitable' | 'file' | 'slides' */
  objType: string
  parentNodeToken: string
  title: string
  hasChild: boolean
}

/** Document content read from wiki. */
export interface WikiDocument {
  nodeToken: string
  objToken: string
  title: string
  /** Raw document body blocks (Feishu docx block model). */
  body: unknown
}

/** Result of a wiki sync (create or update) operation. */
export interface WikiSyncResult {
  nodeToken: string
  objToken: string
  url: string
}
