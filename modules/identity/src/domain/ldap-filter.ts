// Escapes the characters that carry meaning in an LDAP search filter, so text a person types cannot
// change the filter's shape. Used by both directory searches in modules/identity/src/providers/.
export function escapeLdapFilterValue(raw: string): string {
  let out = '';
  for (const ch of raw) {
    switch (ch) {
      case '\0':
        out += '\\00';
        break;
      case '(':
        out += '\\28';
        break;
      case ')':
        out += '\\29';
        break;
      case '*':
        out += '\\2a';
        break;
      case '\\':
        out += '\\5c';
        break;
      default:
        out += ch;
    }
  }
  return out;
}
