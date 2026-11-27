import { Text, Linking } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, InfoChip, ContactRow, DirectionsButton, ratingCell } from "./shared/detail"
import { formatEntryFee } from "../../utils/listingData"
import { WARNING } from "./shared/theme"

const Recreation = () => (
  <ExploreList
    collectionName="recreation"
    title="Recreation"
    subtitle={"Activities\n& fun"}
    sectionTitle="Recreation"
    searchPlaceholder="Search facilities, activities, etc…"
    noun={{ one: "facility", many: "facilities" }}
    emptyIcon="tennis"
    getCard={(r) => ({
      imageChip: formatEntryFee(r.entryFee) ? { text: formatEntryFee(r.entryFee) } : null,
      pill: r.duration ? { icon: "time-outline", text: r.duration } : null,
    })}
    renderDetail={(r, { openDirections, status }) => (
      <>
        <DetailTitle name={r.name} location={r.location} status={status} />

        <MetaCard
          cells={[
            formatEntryFee(r.entryFee) ? { big: formatEntryFee(r.entryFee), label: "Entry fee" } : null,
            ratingCell(r),
            r.duration ? { icon: "time-outline", text: r.duration } : null,
          ]}
        />

        {!!r.ageRestriction && (
          <InfoChip icon="person-outline" color={WARNING} bgClass="bg-warning-light" text={`Age restriction: ${r.ageRestriction}`} />
        )}

        {!!r.phone && <ContactRow icon="call" text={r.phone} onPress={() => Linking.openURL(`tel:${r.phone}`)} />}
        {!!r.email && <ContactRow icon="mail" tone="brand" text={r.email} onPress={() => Linking.openURL(`mailto:${r.email}`)} />}

        <DirectionsButton onPress={() => openDirections(r.coordinates, r.name)} />

        {!!r.description && (
          <Section title="About">
            <Text className="text-[13px] text-ink leading-5">{r.description}</Text>
          </Section>
        )}

        {r.activities.length > 0 && (
          <Section title="Activities">
            <Chips items={r.activities} />
          </Section>
        )}
      </>
    )}
  />
)

export default Recreation
