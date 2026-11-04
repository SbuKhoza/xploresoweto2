import { Text, Linking } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, InfoChip, ContactRow, DirectionsButton } from "./shared/detail"
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
      imageChip: r.entryFee ? { text: String(r.entryFee) } : null,
      pill: r.duration ? { icon: "time-outline", text: r.duration } : null,
    })}
    renderDetail={(r, { openDirections, status }) => (
      <>
        <DetailTitle name={r.name} location={r.location} status={status} />

        <MetaCard
          cells={[
            r.entryFee ? { big: String(r.entryFee), label: "Entry fee" } : null,
            { rating: r.rating, text: `${r.rating} (${r.reviews})` },
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

        {r.activities?.length > 0 && (
          <Section title="Activities">
            <Chips items={r.activities} />
          </Section>
        )}
      </>
    )}
  />
)

export default Recreation
