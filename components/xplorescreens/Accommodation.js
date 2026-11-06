import { useState } from "react"
import { Text, View } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, DirectionsButton, PrimaryButton } from "./shared/detail"
import { Stars } from "./shared/ui"
import ReservationForm from "./ReservationForm"

const priceNum = (a) => Number(a.price) || 0

const Accommodation = () => {
  const [reservationVisible, setReservationVisible] = useState(false)
  const [reservationItem, setReservationItem]       = useState(null)

  const reserve = (item, closeDetail) => {
    closeDetail()
    setReservationItem(item)
    setReservationVisible(true)
  }

  return (
    <>
      <ExploreList
        collectionName="accommodations"
        title="Stay"
        subtitle={"Find your perfect\nplace"}
        sectionTitle="Stay"
        searchPlaceholder="Search places to stay, amenities, etc…"
        noun={{ one: "property", many: "properties" }}
        emptyIcon="bed"
        openNowLabel="Available now"
        extraSorts={[
          { label: "Price: low to high", value: "price-asc",  compare: (a, b) => priceNum(a) - priceNum(b) },
          { label: "Price: high to low", value: "price-desc", compare: (a, b) => priceNum(b) - priceNum(a) },
        ]}
        getCard={(a) => ({
          imageChip: a.price !== undefined && a.price !== null && a.price !== ""
            ? { text: `R${a.price}`, sub: "/night" } : null,
          pill: a.maxGuests ? { icon: "people-outline", text: `${a.maxGuests} guests` } : null,
        })}
        renderDetail={(a, { closeDetail, openDirections, status }) => (
          <>
            <DetailTitle name={a.name} location={a.location} status={status} />

            <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4 mb-3 border border-line">
              <View>
                <Text className="text-[20px] font-extrabold text-ink">R{a.price}</Text>
                <Text className="text-[11px] text-muted mt-0.5">per night</Text>
              </View>
              <View className="items-end">
                <Stars rating={a.rating} size={13} />
                <Text className="text-[11px] text-muted mt-1">{a.rating} · {a.reviews} reviews</Text>
              </View>
            </View>

            <MetaCard
              cells={[
                { icon: "people-outline", text: `Up to ${a.maxGuests} guests` },
                { icon: "calendar-outline", text: "Min. 1 night" },
              ]}
            />

            <DirectionsButton onPress={() => openDirections(a.coordinates, a.name)} />

            {!!a.description && (
              <Section title="About this place">
                <Text className="text-[13px] text-ink leading-5">{a.description}</Text>
              </Section>
            )}

            {a.amenities?.length > 0 && (
              <Section title="Amenities">
                <Chips items={a.amenities} icon="checkmark" />
              </Section>
            )}

            <PrimaryButton label="Reserve Now" onPress={() => reserve(a, closeDetail)} />
          </>
        )}
      />

      <ReservationForm
        visible={reservationVisible}
        onClose={() => setReservationVisible(false)}
        accommodation={reservationItem}
      />
    </>
  )
}

export default Accommodation
