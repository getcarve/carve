#ifndef CARVE_CONTROL_SENSITIVITY_H
#define CARVE_CONTROL_SENSITIVITY_H
#include <stdbool.h>
#include <string.h>
#include <ctype.h>

/* Shared by observation, identity reconstruction and input admission. Page
 * prose is not a credential receiver. Secure semantics always win; labels
 * only refine actual text-entry roles, never links or their containers. */
static inline bool CarveControlIsSensitive(const char *role, const char *subrole, const char *label) {
    if (!role) return false;
    if (!strcmp(role, "AXSecureTextField") || (subrole && !strcmp(subrole, "AXSecureTextField"))) return true;
    if (subrole && !strcmp(subrole, "AXSearchField")) return false;
    if (strcmp(role, "AXTextField") && strcmp(role, "AXTextArea") && strcmp(role, "AXComboBox")) return false;
    char normalized[2048];
    size_t n = 0;
    for (size_t i = 0; label && label[i] && n < sizeof(normalized)-2; ++i) {
        unsigned char c = (unsigned char)label[i];
        if (i && isupper(c) && islower((unsigned char)label[i-1])) normalized[n++] = ' ';
        normalized[n++] = isalnum(c) ? (char)tolower(c) : ' ';
    }
    normalized[n] = '\0';
    const char *terms[] = {"password", "passcode", "secret", "token", "credit card", "social security", "private key", "api key", "security code", "cvv", "otp"};
    for (size_t i = 0; i < sizeof(terms)/sizeof(terms[0]); ++i) {
        const char *p = normalized;
        while ((p = strstr(p, terms[i]))) {
            size_t length = strlen(terms[i]);
            if ((p == normalized || p[-1] == ' ') && (!p[length] || p[length] == ' ')) return true;
            ++p;
        }
    }
    return false;
}
#endif
