# Creating and Managing Sectors

## What is a Sector?
In College Finance, a **Sector** represents a major academic division or administrative cost center (such as `ENG` for Engineering, `SCI` for Applied Sciences, `COM` for Commerce, or `ART` for Humanities). Every student and campus union belongs to a sector so budgets and fee collections roll up cleanly.

## How to Create a Sector
1. Click **Sectors** in the navigation bar.
2. Click **Create Sector** (or ask the AI Assistant to create a sector for you).
3. Enter the required fields:
   - **Sector Code**: Short uppercase identifier (2-10 characters, e.g., `BIO`).
   - **Sector Name**: Descriptive display name (e.g., `Biotechnology`).
   - **Union Name**: Associated student union (e.g., `BioScience Union`).
   - **Annual Budget**: Allocated budget ceiling in INR/USD.
4. Submit the form. The new sector becomes immediately available in the **Students**, **Funds**, and **Import** workflows.

## Sector Budget Guidelines
- Sector codes must be unique; attempting to create a duplicate code returns a `409 Conflict` error.
- Avoid deleting sectors with active enrolled students; reassign students before archiving.
