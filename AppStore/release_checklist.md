# Release Checklist — MisterNobody VPN

## Before First Submission

### Apple Developer Account
- [ ] Apple Developer Program enrolled ($99/year)
- [ ] D-U-N-S Number registered (if company)
- [ ] Banking + tax info filled in App Store Connect
- [ ] Paid Apps agreement signed

### Xcode Project
- [ ] Bundle ID registered: `com.misternobody.app`
- [ ] Extension Bundle ID registered: `com.misternobody.app.tunnel`
- [ ] App Group registered: `group.com.misternobody.app`
- [ ] Network Extension entitlement approved (may require email request to Apple)
- [ ] Provisioning profiles created for both targets (Distribution)
- [ ] RevenueCat API key added to Info.plist
- [ ] Replace placeholder server hosts with production server addresses
- [ ] App icon 1024×1024 PNG added to AppIcon.appiconset

### App Store Connect
- [ ] App record created
- [ ] Bundle ID set to `com.misternobody.app`
- [ ] Age rating questionnaire completed
- [ ] Privacy policy URL added
- [ ] Support URL added
- [ ] In-App Purchases created:
  - [ ] `com.misternobody.app.premium.monthly` (Auto-Renewable)
  - [ ] `com.misternobody.app.premium.yearly` (Auto-Renewable)
  - [ ] `com.misternobody.app.premium.lifetime` (Non-Consumable)
- [ ] RevenueCat entitlement `premium` linked to all 3 products
- [ ] Subscription Group created with display priority

### Metadata (App Store Connect)
- [ ] App name: `MisterNobody VPN`
- [ ] Subtitle: `Private · Fast · Undetectable`
- [ ] Description: copy from `metadata/en-US/description.txt`
- [ ] Keywords: copy from `metadata/en-US/keywords.txt`
- [ ] Screenshots uploaded (6.9", 6.5", 5.5")
- [ ] App Preview video (optional)
- [ ] Privacy Labels configured (matches PrivacyInfo.xcprivacy)

### Build
- [ ] Archive built in Xcode (Product → Archive)
- [ ] Uploaded to App Store Connect via Xcode Organizer
- [ ] Build passes App Store validation
- [ ] TestFlight internal test passed
- [ ] TestFlight external test with 5+ users

### Submission
- [ ] Review Notes filled (use `metadata/en-US/review_notes.txt`)
- [ ] Demo account credentials provided for review
- [ ] Submit for Review

## Production Server Setup
- [ ] VLESS+Reality server configured (Xray-core or sing-box)
- [ ] Server hostnames updated in `ServerRepository.bundledServers`
- [ ] API endpoint for server list implemented (replaces bundled list)
- [ ] SSL certificate for API endpoint
