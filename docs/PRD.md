# ContestHub product requirements

## Overview and problem

ContestHub is a contest discovery and personal tracking app for developers. Contest information is spread across organiser sites, which makes it easy to miss a start time or lose track of an event you wanted to revisit. ContestHub brings upcoming Codeforces contests and manually curated listings into one searchable catalogue. Developers can see when an event starts in their local timezone, save it for later, and open the organiser’s page.

The target users are visitors looking for programming contests, signed-in developers who want a private shortlist, and designated admins who curate listings. Contest registration happens on the organiser’s site. The **View contest** link opens the source page, which may or may not offer registration.

## MVP scope

- Browse and search published contests. Filter by category, source, or upcoming status, move between pages, and open an individual contest. Keep filters and the current page in the URL so they survive refresh and can be shared.
- Import real upcoming Codeforces contests through a backend command. Reimporting the same contest updates its existing record. Label imported listings **Codeforces** and manually entered listings **Curated**.
- Register, log in, and log out. Signed-in users can save or remove contests and view their private bookmarks.
- Allow admins to create, edit, publish, and unpublish curated contests. The importer maintains Codeforces records.
- Validate API inputs, enforce permissions and ownership on the server, and return meaningful errors. Deliver basic automated tests, a working deployment, and a README with setup and test instructions.

Contest hosting, code grading, automatic registration, registration confirmation, restricted scraping, AI recommendations, real-time collaboration, and mass email are outside the project scope. Scheduled imports and measured search tuning are deferred beyond the interview MVP.

## Five screens

| Screen and route | Responsibility | Loading | Empty or initial | Error |
|---|---|---|---|---|
| **Explore contests** `/` | Show search, category/source/upcoming filters, contest cards, and pagination. Cards show the title, source, local start time, and duration when available. Open details or follow the organiser link. | Show loading placeholders for results. | Distinguish an empty catalogue from a search with zero matches. Offer to clear filters when there are no matches. | Explain that contests could not be loaded and offer retry. |
| **Contest details** `/contests/:id` | Show the title, source, local start time, and available details. Provide **View contest** and a bookmark action for signed-in users. | Show a detail placeholder. | Omit unavailable optional details. | Show an unavailable message for a missing or unpublished contest. Offer retry for temporary failures and show a failed bookmark action beside its control. |
| **Login / Register** `/auth` | Switch between login with email and password and registration with name, email, and password. Make logout available from signed-in navigation. | Indicate form submission and prevent repeat submits while it is pending. | Start with a blank form. | Show field validation feedback and a generic message for invalid login credentials. |
| **My bookmarks** `/bookmarks` | List the current user’s saved contests and allow removal. Send signed-out visitors to Login / Register. | Indicate loading while checking the session and fetching bookmarks. | Explain that there are no saved contests and link to Explore. | Offer retry for a list failure and keep the bookmark visible if removal fails. |
| **Admin contest editor** `/admin/contests` | List curated contests and provide a create/edit form with a publish switch. Keep unpublished curated contests available to admins. | Indicate list loading and pending saves. | Offer to create the first curated listing. | Show access denied for a `USER`, send signed-out visitors to Login / Register, and show validation or save errors in the form. |

## Permissions

| Actor | Can do |
|---|---|
| Visitor | Browse and view published contests, follow organiser links, register, and log in. |
| `USER` | Browse published contests, manage their own bookmarks, and log out. |
| `ADMIN` | Do everything a `USER` can do and manage curated listings, including unpublished listings. |

Public registration always creates a `USER`. The first admin is provisioned privately. The API derives bookmark ownership from the authenticated session and checks the role on every admin request.

## Acceptance criteria

These scenarios define what to verify as later stages are built.

| Scenario | Expected result |
|---|---|
| Browse after an import | Upcoming Codeforces records show their source and link to the organiser. Search, filters, and pagination work, and refreshing preserves the Explore URL state. An empty result has a usable empty state. |
| Request invalid pagination or an unavailable contest | Invalid page or limit values return `400`. A missing or unpublished public detail returns `404`, and unpublished records are absent from public lists. |
| View a contest from another timezone | The API returns the same UTC instant. The browser displays it in the viewer’s timezone and labels it as the start time. |
| Use a session | A newly registered user can sign in, view their session, and log out. Expired and revoked sessions cannot be used for protected actions. A signed-out bookmark write returns `401`. |
| Save a contest twice or switch accounts | Two saves by the same user leave one bookmark row. Another user cannot read or change that bookmark. Successful removal updates My bookmarks. |
| Publish or unpublish a curated contest | An admin can find the record in the editor either way. A published record is visible publicly as **Curated**. An ordinary `USER` calling the admin API directly receives `403`. |
| Repeat an import or lose upstream connectivity | The same Codeforces ID leaves one record. A changed start time updates that record. An upstream failure leaves previously stored contests browseable. |
| Verify the deployed MVP | A fresh visitor can browse imported data. Account, bookmark, and admin flows work over HTTPS. The README lets another developer reproduce setup and run the automated tests. |

### Stage 0 review

- [ ] Explain in 60 seconds who uses ContestHub, what problem it solves, what the MVP includes, and what happens on the organiser’s site.
- [ ] Walk through each screen and predict the result for a visitor, a `USER`, and an `ADMIN`.
- [ ] Trace a search from React to PostgreSQL and explain why browsing still works when Codeforces is down.
- [ ] Describe the interview fallback and the features it includes.

The approved schedule uses **27 November 2026** as the checkpoint. If public browsing or repeatable import is still unstable, or sessions are blocking progress, aim for a deployed read-only demo with real Codeforces data, search and filters, contest details, repeatable import, and focused API tests. Describe only the features that work. Keep **30 November–5 December** for interview preparation ahead of **6 December 2026**.

See the [architecture](ARCHITECTURE.md) and [build guide](ContestHub_Build_Guide.md).
