## ADDED Requirements

### Requirement: Musical sample search

Search SHALL accept a key and a tempo range in addition to text, rank musical matches above name matches, and describe each result with its estimates and their confidence. A library with no analysis SHALL say so rather than returning nothing.

#### Scenario: Search by key and tempo

- **WHEN** a producer asks for material in A minor near 124 BPM
- **THEN** analysed samples matching that key and tempo range are returned first

#### Scenario: Unanalysed library

- **WHEN** a musical search runs against a library that has not been analysed
- **THEN** it explains that analysis has not run rather than reporting no matches
