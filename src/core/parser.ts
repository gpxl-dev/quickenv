export interface QuickEnvSection {
  tags: string[];
  variables: Record<string, string>;
}

export function parseEnvQuick(content: string): QuickEnvSection[] {
  const lines = content.split(/\r?\n/);
  const sections: QuickEnvSection[] = [];
  
  let currentTags: string[] = [];
  let currentVariables: Record<string, string> = {};

  // Helper to push current section and reset
  const pushSection = () => {
    if (Object.keys(currentVariables).length > 0 || currentTags.length > 0) {
       // If it's the global section (empty tags) and it's empty, we might skip it?
       // But the tests expect it if there are variables.
       // Actually, my test implementation expects separate sections for separate blocks.
       // Let's just push what we have.
       sections.push({
         tags: currentTags,
         variables: currentVariables
       });
    }
    currentVariables = {};
  };

  // If the file starts with variables, they are global (empty tags).
  // If we encounter a tag header, we finish the current section and start a new one.

  for (let line of lines) {
    line = line.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Check for section header [tag1, tag2]
    const headerMatch = line.match(/^\[(.*)\]$/);
    if (headerMatch) {
      // If we have accumulated variables or if it's a previously defined tagged section (even if empty)
      // we push it. We avoid pushing an empty global section at the start.
      // Logic: If tags are NOT empty, we push (tagged section). 
      // If tags ARE empty (global), we only push if variables are NOT empty.
      
      if (currentTags.length > 0 || Object.keys(currentVariables).length > 0) {
          pushSection();
      }

      // Parse new tags
      const tagContent = headerMatch[1] || "";
      currentTags = tagContent.split(",").map(t => t.trim()).filter(t => t);
      continue;
    }

    // Check for Variable
    const eqIndex = line.indexOf("=");
    if (eqIndex !== -1) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      currentVariables[key] = value;
    }
  }

  // Push the last section
  if (Object.keys(currentVariables).length > 0 || currentTags.length > 0) {
    pushSection();
  }

  return sections;
}

export function serializeEnvQuick(sections: QuickEnvSection[]): string {
  const lines: string[] = [];
  
  for (const section of sections) {
    // Add tag header if there are tags
    if (section.tags.length > 0) {
      lines.push(`[${section.tags.join(', ')}]`);
    }
    
    // Add variables
    for (const [key, value] of Object.entries(section.variables)) {
      lines.push(`${key}=${value}`);
    }
    
    // Add blank line between sections
    lines.push('');
  }
  
  return lines.join('\n');
}
