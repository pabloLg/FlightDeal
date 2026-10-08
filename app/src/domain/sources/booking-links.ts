// Split an opaque urlencoded form body ("u=<payload>") into field name and
// value for a plain HTML form. A form encodes the value exactly once and the
// server decodes once, so value bytes round-trip byte-for-byte (verified
// against SerpAPI booking_request.post_data, which always starts with "u=").
export function splitPostData(
  postData: string,
): { name: string; value: string } | null {
  const eq = postData.indexOf("=");
  if (eq <= 0) return null;
  return { name: postData.slice(0, eq), value: postData.slice(eq + 1) };
}
