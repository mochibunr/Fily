//! Pure, dependency-free filesystem logic for Fily.
//!
//! Kept free of Tauri/filesystem access so it can be unit-tested with
//! `rustc --test` even on machines without GTK/WebKit system libraries.

/// Split `name` into (stem, ext-with-dot). `archive.tar.gz` -> ("archive.tar", ".gz").
pub fn split_stem_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// Strip one trailing ` (n)` suffix: `photo (2)` -> `photo`.
pub fn strip_copy_suffix(stem: &str) -> &str {
    if !stem.ends_with(')') {
        return stem;
    }
    if let Some(open) = stem.rfind(" (") {
        let inner = &stem[open + 2..stem.len() - 1];
        if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_digit()) {
            return &stem[..open];
        }
    }
    stem
}

/// "Keep both" file name: `photo.jpg` -> `photo (2).jpg`, counting up until
/// `exists` returns false. `exists` is consulted at most 10_000 times.
pub fn keep_both_name(name: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(name) {
        return name.to_string();
    }
    let (stem, ext) = split_stem_ext(name);
    let base = strip_copy_suffix(stem);
    for i in 2..10_000 {
        let candidate = format!("{base} ({i}){ext}");
        if !exists(&candidate) {
            return candidate;
        }
    }
    format!("{stem} (copy){ext}")
}

/// True when `path` is a location permanent deletion must always refuse:
/// filesystem root, the user's home dir, or a single component below root
/// (`/home`, `/usr`, `C:\`, …).
pub fn is_protected(path: &str, home: &str) -> bool {
    // Normalize trailing slashes (but keep a lone root intact).
    let p = if path.len() > 1 {
        path.trim_end_matches(['/', '\\'])
    } else {
        path
    };
    if p == "/" || p == "\\" {
        return true;
    }
    // Windows drive root, e.g. `C:` or `C:\`.
    if p.len() <= 3
        && p.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && p.as_bytes().get(1) == Some(&b':')
    {
        return true;
    }
    if !home.is_empty() && (p == home || p == home.trim_end_matches(['/', '\\'])) {
        return true;
    }
    // Exactly one component below root: `/usr`, `C:\Windows`.
    let trimmed = p.trim_start_matches(['/', '\\']);
    if p.starts_with(['/', '\\']) {
        return !trimmed.contains('/') && !trimmed.contains('\\');
    }
    if trimmed.len() > 2 && trimmed.as_bytes()[1] == b':' {
        let rest = &trimmed[2..].trim_start_matches(['/', '\\']);
        return !rest.is_empty() && !rest.contains(['/', '\\']);
    }
    false
}

/// Case-insensitive substring match used for filename search.
pub fn name_matches(name: &str, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    name.to_lowercase().contains(&query.to_lowercase())
}

/// Validate a candidate display name for create/rename: non-empty, no NUL,
/// no path separators.
pub fn is_valid_entry_name(name: &str) -> bool {
    !(name.is_empty() || name.contains('\0') || name.contains('/') || name.contains('\\'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn exists_in(set: &HashSet<String>) -> impl Fn(&str) -> bool + '_ {
        move |n: &str| set.contains(n)
    }

    #[test]
    fn stem_ext_splits_correctly() {
        assert_eq!(split_stem_ext("photo.jpg"), ("photo", ".jpg"));
        assert_eq!(split_stem_ext("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_stem_ext("Makefile"), ("Makefile", ""));
        assert_eq!(split_stem_ext(".gitignore"), (".gitignore", ""));
    }

    #[test]
    fn keep_both_counts_up() {
        let set: HashSet<String> = ["a.txt", "a (2).txt"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(keep_both_name("a.txt", exists_in(&set)), "a (3).txt");
        assert_eq!(keep_both_name("fresh.txt", exists_in(&set)), "fresh.txt");
    }

    #[test]
    fn keep_both_restarts_from_suffixed_source() {
        // Duplicating `a (2).txt` must yield `a (3).txt`, not `a (2) (2).txt`.
        let set: HashSet<String> = ["a (2).txt"].into_iter().map(String::from).collect();
        assert_eq!(keep_both_name("a (2).txt", exists_in(&set)), "a (3).txt");
    }

    #[test]
    fn protected_targets_refused() {
        assert!(is_protected("/", "/home/u"));
        assert!(is_protected("/home/u", "/home/u"));
        assert!(is_protected("/home", "/home/u"));
        assert!(is_protected("/usr", "/home/u"));
        assert!(is_protected("C:\\", "C:\\Users\\u"));
        assert!(is_protected("C:\\Windows", "C:\\Users\\u"));
        assert!(!is_protected("/home/u/docs", "/home/u"));
        assert!(!is_protected("C:\\Users\\u\\docs", "C:\\Users\\u"));
    }

    #[test]
    fn search_matching_is_case_insensitive() {
        assert!(name_matches("Report.PDF", "report"));
        assert!(name_matches("anything", ""));
        assert!(!name_matches("photo.jpg", "report"));
    }

    #[test]
    fn entry_names_validated() {
        assert!(is_valid_entry_name("notes.txt"));
        assert!(!is_valid_entry_name(""));
        assert!(!is_valid_entry_name("a/b"));
        assert!(!is_valid_entry_name("a\\b"));
        assert!(!is_valid_entry_name("a\0b"));
    }
}
