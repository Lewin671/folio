type Transfer = Pick<DataTransfer, "files" | "items">;

export function hasImageFile(data: Transfer): boolean {
  // During dragover, browsers expose item types but protect the file contents.
  return Array.from(data.files).some((file) => file.type.startsWith("image/")) ||
    Array.from(data.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}

export function imageFile(data: Transfer): File | undefined {
  const file = Array.from(data.files).find((file) => file.type.startsWith("image/"));
  if (file) return file;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
}
