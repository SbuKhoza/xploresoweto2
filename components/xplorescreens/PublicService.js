import { Text, Linking } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, InfoChip, ContactRow, DirectionsButton } from "./shared/detail"
import { SUCCESS } from "./shared/theme"

const PublicService = () => (
  <ExploreList
    collectionName="publicservice"
    title="Public Services"
    subtitle={"Government\n& community"}
    sectionTitle="Public Services"
    searchPlaceholder="Search services, offices, etc…"
    noun={{ one: "service", many: "services" }}
    emptyIcon="office-building"
    editorialBadges={false}
    getCard={(s) => ({
      imageChip: s.accessibility ? { icon: "accessibility", text: "Accessible" } : null,
      pill: s.hours ? { icon: "time-outline", text: s.hours } : null,
    })}
    renderDetail={(s, { openDirections, status }) => (
      <>
        <DetailTitle name={s.name} location={s.location} status={status} />

        <MetaCard
          cells={[
            s.hours ? { icon: "time-outline", text: s.hours } : null,
            { rating: s.rating, text: `${s.rating} (${s.reviews})` },
            { icon: "business-outline", text: s.category || s.type },
          ]}
        />

        {!!s.accessibility && (
          <InfoChip icon="accessibility" color={SUCCESS} bgClass="bg-success-light" text="Wheelchair accessible" />
        )}

        {!!s.website && (
          <ContactRow icon="globe-outline" text={s.website} onPress={() => Linking.openURL(s.website)} chevron="open-outline" />
        )}
        {!!s.phone && <ContactRow icon="call" text={s.phone} onPress={() => Linking.openURL(`tel:${s.phone}`)} />}
        {!!s.email && <ContactRow icon="mail" tone="brand" text={s.email} onPress={() => Linking.openURL(`mailto:${s.email}`)} />}

        <DirectionsButton onPress={() => openDirections(s.coordinates, s.name)} />

        {!!s.description && (
          <Section title="About">
            <Text className="text-[13px] text-ink leading-5">{s.description}</Text>
          </Section>
        )}

        {s.services?.length > 0 && (
          <Section title="Services Offered">
            <Chips items={s.services} />
          </Section>
        )}
      </>
    )}
  />
)

export default PublicService
