# Access

Every note belongs to the user who created it. Notes are private: nobody else may read, change or delete them.

Ownership is checked in `src/policy.js` before a route runs. A route that acts on a single note is listed in `OWNED`; the route code itself does not check the owner again.
