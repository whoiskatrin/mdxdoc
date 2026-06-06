import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { mdxdocProseMirrorSchema, proseMirrorJsonToSource, sourceToProseMirrorJson, type ProseMirrorJson } from "@mdxdoc/mdx";

export const SOURCE_TEXT_NAME = "markdown";
export const PROSEMIRROR_FRAGMENT_NAME = "prosemirror";

export function ydocFromSource(source: string): Y.Doc {
  const doc = new Y.Doc();
  const text = doc.getText(SOURCE_TEXT_NAME);
  text.insert(0, source);
  const fragment = doc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
  prosemirrorJSONToYXmlFragment(mdxdocProseMirrorSchema, sourceToProseMirrorJson(source), fragment);
  return doc;
}

export function sourceFromYdoc(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
  if (fragment.length > 0) {
    return proseMirrorJsonToSource(yXmlFragmentToProsemirrorJSON(fragment) as ProseMirrorJson);
  }
  return doc.getText(SOURCE_TEXT_NAME).toString();
}

export function snapshotFromSource(source: string): Uint8Array {
  return Y.encodeStateAsUpdate(ydocFromSource(source));
}

export function sourceFromSnapshot(snapshot: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  return sourceFromYdoc(doc);
}
