#import <Foundation/Foundation.h>

// Match the capture helper's Swift Character prefix, then the controller's
// trim and UTF-16 cap. Comparing a bounded observation to an unbounded native
// label would reject the same receiver merely because its label is long.
NS_INLINE NSString* CarveCapturedIdentity(NSString* value, NSUInteger characters, NSUInteger utf16Limit) {
  if (!value) return nil;
  __block NSUInteger count = 0;
  __block NSUInteger end = 0;
  [value enumerateSubstringsInRange:NSMakeRange(0, value.length)
    options:NSStringEnumerationByComposedCharacterSequences
    usingBlock:^(__unused NSString* substring, NSRange range, __unused NSRange enclosingRange, BOOL* stop) {
      end = NSMaxRange(range);
      count++;
      if (count >= characters) *stop = YES;
    }];
  NSString* captured = [[value substringToIndex:end] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return [captured substringToIndex:MIN(captured.length, utf16Limit)];
}
