import * as React from "react";
import * as Y from "yjs";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";

export function WysiwygEditor({ doc, readOnly }: { doc: Y.Doc; readOnly: boolean }) {
  const fragment = React.useMemo(() => doc.getXmlFragment("prosemirror"), [doc]);
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: doc, field: "prosemirror", fragment })
    ],
    editorProps: {
      attributes: {
        class: "tiptap-editor"
      }
    }
  }, [doc]);

  React.useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  return <EditorContent editor={editor} />;
}
