import { toast } from "sonner";
import { describeApiError, generalWorkApi } from "@/lib/general-work-api";

/** Opens a stored file in a new tab using a fresh short-lived signed URL. */
export async function openFile(fileId: string): Promise<void> {
  // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at the file.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const url = await generalWorkApi.fileUrl(fileId);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (error) {
    tab?.close();
    toast.error(describeApiError(error, "Couldn't open the file."));
  }
}

/** Downloads a stored file; the signed URL is served as an attachment so the page stays put. */
export async function downloadFile(fileId: string): Promise<void> {
  try {
    window.location.assign(await generalWorkApi.fileUrl(fileId, true));
  } catch (error) {
    toast.error(describeApiError(error, "Couldn't download the file."));
  }
}
