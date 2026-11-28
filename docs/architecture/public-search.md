# Public search

The finishing plan's Phase 9 row "Search judged on guidance, articles, industries and services as well
as templates" (WEB-003). WEB-003 asks Valo to "Search approved public templates, guidance, industries,
articles and service categories, with type and industry filters", and accepts it when "unpublished
content and customer drafts never appear; a curated 50-query relevance test meets its agreed pass
threshold."

## What there was

**The search.** The library's search reads one list: every released template, guide to the rules and
article, then the 20 industry pages and the 7 service categories. It found an item when every word
typed began a word of the item's title, description, category or industry. It read "bill" as
"invoice", "quote" as "quotation", and "employee" and "workers" as "staff".

**Its test.** Fifty searches over the 40 templates alone, nearly all for a word or two of a template's
own title or description. None was for a guide, an article, an industry page or a service category.

## What was measured first

The list a search is now judged on is the library's own, as it would stand were every draft kept in
the repository released: the 40 templates, the 30 guides to the rules and the 38 articles, each as
the staff library lists a released entry, then the industry pages and the service categories. That
is 135 items. Nothing is released to make it, and no row is written.

Fifty searches were written across the five kinds, as a business owner might type them: 14 for a
template, 12 for a guide to the rules, 10 for an article, 8 for an industry page and 6 for a service
category. A search passes when the item it should find is among the first three results, with the
list in the order given and in the reverse order. Equal scores keep the list's order, which is the
order entries were released in, so a result that depends on it is not counted.

**The search as it was found 29 of the 50.** The 21 it missed fell into a few kinds:

| What was typed | Why nothing was found |
| --- | --- |
| "purchase orders", "unpaid invoices", "expense claims" | A plural, where the item has the singular |
| "how to write a quotation", "minutes of meeting", "register my business" | The small words of a question or a phrase, which no item has |
| "NDA", "TIN", "waybill" | A short or everyday name for what the site calls something else |
| "hotel", "shop", "school", "farming" | A kind of business, where the industry page has only the industry's name |
| "accountant", "lawyer" | A person, where the service category names the work |
| "invoice template" | The kind of item, which a template's own words do not say |
| "privacy policy", "handover" | The same thing written another way |

## What a search reads now

A search finds the items that have every word that says what is wanted. What changed first is how a
word is read (`modules/catalogue/search-words.ts`, `valo-catalogue.ts`). What a search lists when no
item has every word came second, and is under "The closest items" below.

- **A plural is its singular**, in the search and in the item: "invoices" finds "Invoice", and
  "policy" finds "policies". A possessive is the word itself.
- **A word still being typed** finds the words that begin with it, as before.
- **The small words of a question or a phrase are left out** when the search has other words:
  "how to write a quotation" is a search for "write" and "quotation". "No" is not one of them. A
  search of small words alone is a search for them.
- **Two words for the same thing find each other's items**: "staff" finds the Employee handbook and
  "employees" the Staff onboarding checklist. There are 18 such words, among them contract for
  agreement, stock for inventory, NDA, TIN, LPO and waybill, and ten phrases, among them "privacy
  policy" for "privacy notice".
- **An everyday word finds what the site files it under**: "hotel" finds the hospitality pages, "lawyer"
  the legal category and "VAT" the tax items. The site's own word finds nothing more for it. There are
  125 such words: what a document is called, people and advisers, the short names of registration, tax
  and data protection, and kinds of business by industry.
- **A word that says only that the searcher is a business** (company, business, firm, startup and five
  more) rules no item out when the search has other words, and counts for an item that has it:
  "construction company" finds the construction page, and "company annual returns" still puts the
  company's guide first.
- **A word in "-ing" or "-ed"** also finds the word it comes from, when that leaves four letters or
  more: "starting" finds "start".
- **An item's kind is read**, so "invoice template" finds the template. The words "All industries" are
  not, since they name no industry: a search for "industries" no longer finds every general item.

**The order of results.** An item scores for each wanted word: most where its title has the word or
another word for the same thing, less where its title is only filed under it, less again where a
title word only begins with it, and least where the word is elsewhere in the item. A title that is
the search comes first, then one that begins with it, then one that has its words together. Those
three now count whole words only, so "hospital" is not found inside "hospitality". Without that, a
search for "hospital" put the hospitality pages above the healthcare ones it is filed under.

**The lists are a starting point, and the owner's to change.** A word in them only widens what a
search finds. It says nothing about what an item covers.

## What was measured afterwards

| Set | When it was written | Found at its first run | Found with the words read as above | Found with the closest items |
| --- | --- | --- | --- | --- |
| The curated 50 | Before any change | 29 | 50 | 50 |
| A second 50 | After the changes made for the first | 41 | 47 | 50 |
| A third 50, worded more loosely | After the changes made for the second | 29 | 42 | 45 |

**The first number of each row is the honest one for searches the search has not met.** The curated
set was the one the changes were made against. The second and third were each written after the
search was last changed and run once before anything was changed for them.

- **After the first set's run** most of the rules above were made, and it found 49.
- **The second set's first run**, and the one search the first set still missed, led to two more rules
  (a business word rules nothing out, and "-ing" and "-ed"), to "long", "much" and "many" being read
  as small words, and to three more everyday words. The first set then found 50 and the second 47.
- **The third set's first run** led to the rule that a title's phrase counts whole words only, with
  which it found 30, and then to 21 more words and one phrase, with which it finds 42.

**With the words read as above, eleven searches were still missed.** Each has a word that the title
and description of its item do not have: "refund policy", "unfair contract terms", "data subject
request", "privacy notice for customers", "data access request", "tax consultant", "NAFDAC permit",
"employment letter", "customer receipts", "minutes and actions" and "filing documents". Since an item
had to have every wanted word, each of these found nothing at all, or nothing useful.

## The closest items

**When no item has every word a search must have, the catalogue lists the items that have the most of
them**, and its answer says so (`closest`). The library then says "Nothing has all the words you
typed. These have some of them." above the results.

- **Which items.** Those that have at least one of the words and lack the fewest. An item that has
  two of three words is listed, and one that has one of them is not.
- **A business word does not count.** "Zebra company" lists nothing, though many items say "company".
- **Nothing is the closest to a word no item has.** A search for "zebra" finds nothing, as before.
- **The filters still apply**, and the order is by the same score.
- **A search an item answers in full is as it was.** The closest items are listed only where the
  results would have been empty.

**Six of the eleven are now found**: all three of the second set, and "data access request", "minutes
and actions" and "NAFDAC permit" of the third. **Five are still missed**, and are named in the test,
which fails if one of them starts to pass or another starts to fail:

- "customer receipts": an item has both words, and it is not the guide the search was written for.
- "employment letter", "privacy notice for customers", "filing documents" and "tax consultant": other
  items have as many of the search's words as its own item has, or more.

## The filters

The type and industry filters were built already, and are now tested over all five kinds. A type
lists the items of that kind and no other. An industry lists what is filed under it and what is for
every industry. The two combine with each other and with a search.

**Found on the way.** The library's category filter did not offer "Industry packs", which the list
has had since deeper industry packs were added. It offers it now.

## Unreleased content

A test against PostgreSQL already showed that candidate and held versions of the reviewed route, and a
customer's draft, never appear in a search. A second test now does the same for the staff library,
through the library's own functions: a Content editor's draft and release, and the development
owner's sign-off of a regulatory article on a source check of its exact text.

- A released template, practical guide and regulatory article are each found under their own type
  and no other, and the guide under its industry.
- A draft that was never released, a regulatory article the owner has not signed, and a customer's
  document that carries the same word are never found.
- A later draft of a released guide is not found by its new words, and the released version still
  is. Once the later draft is released, its words are found and the replaced version's are not.
- A held version leaves the search and comes back when the hold is lifted. A withdrawn one leaves it.

Every entry in that test is synthetic and is withdrawn at its end.

## What is not done

- **No pass threshold is agreed, and the searches are the builder's.** The owner agrees both. Until
  then WEB-003's acceptance is not met, whatever the tests show.
- **The closest items are found by counting words.** A search whose words are all in some item, but
  that means another, is not helped.
- **The lists grow only by hand.** Nothing records the searches that found nothing, so the words
  visitors really use are not known. Recording them is a privacy decision for the owner.
- **Only an item's title and the first 260 characters of its description are read.** A word deeper in
  a guide is not found. Four of the six guides about a registered business name do not say "CAC" in
  that opening, so a search for "CAC" finds them only through the word "registration".
- **Spelling mistakes are not corrected.**
